const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const archiver = require("archiver");
const crypto = require("crypto");

const app = express();
const BASE_DIR = path.resolve(process.env.FILE_SERVER_ROOT || "./data");
const ENV = process.env.ENV || "DEVELOPMENT";
const ENFORCE_HTTPS = process.env.ENFORCE_HTTPS === "true";
const ZIP_RATE_LIMIT_WINDOW_MS = parseInt(process.env.ZIP_RATE_LIMIT_WINDOW_MS || "900000", 10);
const ZIP_RATE_LIMIT_MAX = parseInt(process.env.ZIP_RATE_LIMIT_MAX || "20", 10);
const SHARE_RATE_LIMIT_WINDOW_MS = parseInt(process.env.SHARE_RATE_LIMIT_WINDOW_MS || "900000", 10);
const SHARE_RATE_LIMIT_MAX = parseInt(process.env.SHARE_RATE_LIMIT_MAX || "30", 10);
const PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS = parseInt(process.env.PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS || "900000", 10);
const PUBLIC_SHARE_RATE_LIMIT_MAX = parseInt(process.env.PUBLIC_SHARE_RATE_LIMIT_MAX || "60", 10);
const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || "900000", 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "5", 10);
const LOGIN_BAN_MS = parseInt(process.env.LOGIN_BAN_MS || "900000", 10);
const AUTH_SESSION_TTL_MS = parseInt(process.env.AUTH_SESSION_TTL_MS || "43200000", 10);

const shareTokens = new Map();
const rateLimitBuckets = new Map();
const authSessions = new Map();
const loginAttempts = new Map();
const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPLOAD_SIZE_BYTES = parseSize(process.env.MAX_UPLOAD_SIZE);
const GENERATED_PASSWORD_FILE_NAME = ".muttley-auth-password";

function parseSize(value) {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
    if (!match) {
        console.warn(`Invalid MAX_UPLOAD_SIZE "${value}". Upload size limit disabled.`);
        return null;
    }
    const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
    const unit = (match[2] || "b").toLowerCase();
    return Math.floor(parseFloat(match[1]) * units[unit]);
}

function timingSafeEqualString(a = "", b = "") {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function parseCookies(header = "") {
    return header.split(";").reduce((cookies, part) => {
        const index = part.indexOf("=");
        if (index === -1) return cookies;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || "unknown";
}

function isHttpsRequest(req) {
    return req.secure || req.get("x-forwarded-proto") === "https";
}

function setSessionCookie(req, res, token) {
    const parts = [
        `muttley_session=${encodeURIComponent(token)}`,
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        `Max-Age=${Math.floor(AUTH_SESSION_TTL_MS / 1000)}`,
    ];
    if (ENFORCE_HTTPS || isHttpsRequest(req)) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", "muttley_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function getSession(req) {
    const token = parseCookies(req.headers.cookie).muttley_session;
    if (!token) return null;
    const session = authSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        authSessions.delete(token);
        return null;
    }
    return { token, session };
}

function generatePassword() {
    return crypto.randomBytes(24).toString("base64url");
}

function getGeneratedPasswordPath() {
    return path.join(BASE_DIR, GENERATED_PASSWORD_FILE_NAME);
}

function isGeneratedPasswordPath(targetPath) {
    return path.resolve(targetPath) === getGeneratedPasswordPath();
}

function assertNotInternalFile(targetPath) {
    if (isGeneratedPasswordPath(targetPath)) {
        throw new Error("This internal Muttley file cannot be managed from the file manager.");
    }
}

function resolveAuthPassword(username) {
    if (!username) {
        if (process.env.AUTH_PASSWORD) {
            console.warn("AUTH_PASSWORD is set but AUTH_USERNAME is missing. Authentication is disabled.");
        }
        return null;
    }

    if (process.env.AUTH_PASSWORD) return process.env.AUTH_PASSWORD;

    const passwordPath = getGeneratedPasswordPath();
    let password = "";
    let created = false;
    if (fs.existsSync(passwordPath)) {
        password = fs.readFileSync(passwordPath, "utf-8").trim();
    }
    if (!password) {
        password = generatePassword();
        fs.writeFileSync(passwordPath, `${password}\n`, { mode: 0o600 });
        created = true;
    }
    fs.chmodSync(passwordPath, 0o600);

    console.log("------------------------------------------------------------");
    console.log("  Muttley login password");
    console.log("------------------------------------------------------------");
    console.log(`  Status:   ${created ? "Generated new password" : "Loaded stored password"}`);
    console.log("  Reason:   AUTH_PASSWORD is not set");
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log(`  Stored:   ${passwordPath}`);
    console.log("------------------------------------------------------------");
    return password;
}

// Cleanup expired tokens hourly
setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of shareTokens.entries()) {
        if (now > entry.expiresAt) shareTokens.delete(token);
    }
    for (const [token, session] of authSessions.entries()) {
        if (now > session.expiresAt) authSessions.delete(token);
    }
    for (const [ip, attempt] of loginAttempts.entries()) {
        if (now > attempt.resetAt && (!attempt.bannedUntil || now > attempt.bannedUntil)) {
            loginAttempts.delete(ip);
        }
    }
}, 60 * 60 * 1000);

const FRONTEND_DIR = path.resolve(__dirname, "../frontend");

if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== "false") {
    app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
}

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
            "font-src 'self' https://cdnjs.cloudflare.com data:",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "frame-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ].join("; ")
    );
    const isHttps = isHttpsRequest(req);
    if (isHttps) {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (ENFORCE_HTTPS && !isHttps) {
        if (req.method === "GET" || req.method === "HEAD") {
            return res.redirect(308, `https://${req.get("host")}${req.originalUrl}`);
        }
        return res.status(403).json({ error: "HTTPS is required." });
    }
    next();
});

app.use(express.static(FRONTEND_DIR));

// Ensure the base directory exists
if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
}

// Authentication setup
const USERNAME = process.env.AUTH_USERNAME || null;
const PASSWORD = resolveAuthPassword(USERNAME);

// Middleware for JSON and form parsing
const bodyLimit = MAX_UPLOAD_SIZE_BYTES ? { limit: MAX_UPLOAD_SIZE_BYTES } : { limit: "1gb" };
app.use(express.json(bodyLimit));
app.use(express.urlencoded({ extended: true, ...bodyLimit }));

function createRateLimiter({ windowMs, max, label }) {
    return (req, res, next) => {
        const key = `${label}:${req.ip}`;
        const now = Date.now();
        const bucket = rateLimitBuckets.get(key);

        if (!bucket || now > bucket.resetAt) {
            rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        bucket.count += 1;
        if (bucket.count > max) {
            res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
            return res.status(429).json({ error: "Too many requests. Please try again later." });
        }

        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitBuckets.entries()) {
        if (now > bucket.resetAt) rateLimitBuckets.delete(key);
    }
}, 60 * 1000);

const zipRateLimit = createRateLimiter({
    windowMs: ZIP_RATE_LIMIT_WINDOW_MS,
    max: ZIP_RATE_LIMIT_MAX,
    label: "zip",
});

const shareRateLimit = createRateLimiter({
    windowMs: SHARE_RATE_LIMIT_WINDOW_MS,
    max: SHARE_RATE_LIMIT_MAX,
    label: "share",
});

const publicShareRateLimit = createRateLimiter({
    windowMs: PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS,
    max: PUBLIC_SHARE_RATE_LIMIT_MAX,
    label: "public-share",
});

function findActiveShareToken(filePath, isDirectory) {
    const now = Date.now();
    for (const [token, entry] of shareTokens.entries()) {
        if (now > entry.expiresAt) {
            shareTokens.delete(token);
            continue;
        }
        if (entry.filePath === filePath && entry.isDirectory === isDirectory) {
            return { token, entry };
        }
    }
    return null;
}

function isAuthEnabled() {
    return Boolean(USERNAME && PASSWORD);
}

function requireAuth(req, res, next) {
    if (!isAuthEnabled()) return next();
    if (getSession(req)) return next();
    return res.status(401).json({ error: "Authentication required" });
}

function checkLoginBan(req, res, next) {
    const ip = getClientIp(req);
    const attempt = loginAttempts.get(ip);
    if (attempt?.bannedUntil && Date.now() < attempt.bannedUntil) {
        res.setHeader("Retry-After", Math.ceil((attempt.bannedUntil - Date.now()) / 1000));
        return res.status(429).json({ error: "Too many failed login attempts. Try again later." });
    }
    next();
}

function recordFailedLogin(req) {
    const ip = getClientIp(req);
    const now = Date.now();
    const attempt = loginAttempts.get(ip);
    const nextAttempt = !attempt || now > attempt.resetAt
        ? { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS, bannedUntil: 0 }
        : { ...attempt, count: attempt.count + 1 };
    if (nextAttempt.count >= LOGIN_RATE_LIMIT_MAX) {
        nextAttempt.bannedUntil = now + LOGIN_BAN_MS;
    }
    loginAttempts.set(ip, nextAttempt);
}

function clearFailedLogins(req) {
    loginAttempts.delete(getClientIp(req));
}

// Public share download — must be before auth middleware
app.get("/share/:token", publicShareRateLimit, (req, res) => {
    const { token } = req.params;
    const entry = shareTokens.get(token);
    if (!entry) return res.status(404).send("Share link not found or expired.");
    if (Date.now() > entry.expiresAt) {
        shareTokens.delete(token);
        return res.status(410).send("Share link has expired.");
    }
    if (!fs.existsSync(entry.filePath)) return res.status(404).send("File no longer exists.");
    safeLstatSync(entry.filePath);
    if (entry.isDirectory) {
        return streamDirectoryZip(res, entry.filePath, entry.fileName);
    }
    res.download(entry.filePath, entry.fileName);
});

app.get("/auth/status", (req, res) => {
    res.json({ authEnabled: isAuthEnabled(), authenticated: !isAuthEnabled() || Boolean(getSession(req)) });
});

app.post("/auth/login", checkLoginBan, (req, res) => {
    if (!isAuthEnabled()) return res.json({ authenticated: true });
    const { username, password } = req.body || {};
    const valid = timingSafeEqualString(username, USERNAME) && timingSafeEqualString(password, PASSWORD);
    if (!valid) {
        recordFailedLogin(req);
        return res.status(401).json({ error: "Invalid username or password" });
    }
    clearFailedLogins(req);
    const token = crypto.randomBytes(32).toString("hex");
    authSessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + AUTH_SESSION_TTL_MS });
    setSessionCookie(req, res, token);
    res.json({ authenticated: true });
});

app.post("/auth/logout", (req, res) => {
    const current = getSession(req);
    if (current) authSessions.delete(current.token);
    clearSessionCookie(res);
    res.json({ authenticated: false });
});

if (!isAuthEnabled()) {
    console.log("Authentication is disabled. Running without authentication.");
}

app.use(requireAuth);

function isInsideBase(resolvedPath) {
    const relative = path.relative(BASE_DIR, resolvedPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlinkPath(resolvedPath, { allowMissingLeaf = false } = {}) {
    const relative = path.relative(BASE_DIR, resolvedPath);
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    let current = BASE_DIR;
    const baseStats = fs.lstatSync(BASE_DIR);
    if (baseStats.isSymbolicLink()) throw new Error("Symlinks are not allowed.");

    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        if (allowMissingLeaf && index === parts.length - 1 && !fs.existsSync(current)) return;
        const stats = fs.lstatSync(current);
        if (stats.isSymbolicLink()) throw new Error("Symlinks are not allowed.");
    }
}

function safeLstatSync(targetPath) {
    const stats = fs.lstatSync(targetPath);
    if (stats.isSymbolicLink()) throw new Error("Symlinks are not allowed.");
    return stats;
}

function assertNotSymlinkIfExists(targetPath) {
    if (fs.existsSync(targetPath)) safeLstatSync(targetPath);
}

// Helper to validate and resolve safe paths
function safePath(targetPath = "") {
    const resolvedPath = path.resolve(BASE_DIR, targetPath || "");
    if (!isInsideBase(resolvedPath)) {
        throw new Error("Access outside the root directory is forbidden.");
    }
    assertNoSymlinkPath(resolvedPath);
    return resolvedPath;
}

function safeName(name, label = "name") {
    if (typeof name !== "string" || !name.trim()) {
        throw new Error(`Invalid ${label}`);
    }
    if (name !== path.basename(name) || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
        throw new Error(`Invalid ${label}`);
    }
    return name;
}

function safeChildPath(parentDir, name, label = "name") {
    const childPath = path.resolve(parentDir, safeName(name, label));
    if (!isInsideBase(childPath) || path.dirname(childPath) !== parentDir) {
        throw new Error("Access outside the root directory is forbidden.");
    }
    assertNoSymlinkPath(parentDir);
    return childPath;
}

function streamDirectoryZip(res, dirPath, zipName) {
    const archive = archiver("zip", { zlib: { level: 9 } });
    res.attachment(zipName);
    res.setHeader("Content-Type", "application/zip");

    archive.on("error", (err) => {
        console.error("Archive error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Error creating ZIP file" });
        } else {
            res.end();
        }
    });

    archive.pipe(res);
    addDirectoryToArchive(archive, dirPath, "");
    archive.finalize();
}

function addDirectoryToArchive(archive, dirPath, archiveRoot) {
    for (const item of fs.readdirSync(dirPath)) {
        const itemPath = path.join(dirPath, item);
        if (isGeneratedPasswordPath(itemPath)) continue;
        const stats = safeLstatSync(itemPath);
        const archivePath = archiveRoot ? `${archiveRoot}/${item}` : item;
        if (stats.isDirectory()) {
            addDirectoryToArchive(archive, itemPath, archivePath);
        } else if (stats.isFile()) {
            archive.file(itemPath, { name: archivePath });
        }
    }
}

function enforceUploadSize(size) {
    if (MAX_UPLOAD_SIZE_BYTES && Number(size) > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error(`Upload exceeds the configured limit of ${MAX_UPLOAD_SIZE_BYTES} bytes.`);
    }
}

// Format file size
function formatSize(size) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(2)} ${units[i]}`;
}

// Config route
app.get("/config", (req, res) => {
    res.json({ base_dir: BASE_DIR });
});

// List directory contents
app.post("/list", (req, res) => {
    try {
        let currentDir = req.body.current_dir || BASE_DIR;
        const action = req.body.action || null;

        if (action === "go_back") {
            currentDir = path.dirname(currentDir);
            if (!isInsideBase(path.resolve(currentDir))) currentDir = BASE_DIR;
        }

        if (action === "go_root") currentDir = BASE_DIR;

        const safeDir = safePath(currentDir);

        function calculateDirSize(dir) {
            const items = fs.readdirSync(dir);
            return items.reduce((totalSize, item) => {
                const fullPath = path.join(dir, item);
                const stats = safeLstatSync(fullPath);
                return totalSize + (stats.isDirectory() ? calculateDirSize(fullPath) : stats.size);
            }, 0);
        }

        const items = fs.readdirSync(safeDir).filter((item) => {
            return !isGeneratedPasswordPath(path.join(safeDir, item));
        }).map((item) => {
            const fullPath = path.join(safeDir, item);
            const stats = safeLstatSync(fullPath);
            return {
                name: item,
                is_dir: stats.isDirectory(),
                size: stats.isDirectory() ? formatSize(calculateDirSize(fullPath)) : formatSize(stats.size),
                last_modified: stats.mtimeMs,
            };
        });

        items.sort((a, b) => {
            if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
            return a.is_dir ? -1 : 1;
        });

        res.json({ current_dir: safeDir, items });
    } catch (err) {
        console.error("Error:", err);
        res.status(400).json({ error: err.message });
    }
});

// File upload
const upload = multer({
    limits: MAX_UPLOAD_SIZE_BYTES ? { fileSize: MAX_UPLOAD_SIZE_BYTES } : undefined,
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            try {
                const safeDir = safePath(req.body.target_dir || BASE_DIR);
                cb(null, safeDir);
            } catch (err) {
                cb(err);
            }
        },
        filename: (req, file, cb) => {
            try {
                cb(null, `.${safeName(file.originalname, "file name")}.part`);
            } catch (err) {
                cb(err);
            }
        },
    }),
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (req.headers["content-type"] === "application/json") {
            const { file_name, content, target_dir = "" } = req.body;

            if (!file_name || content === undefined) {
                return res.status(400).json({ error: "File name or content is missing" });
            }

            const safeDir = safePath(target_dir);
            const filePath = safeChildPath(safeDir, file_name, "file name");
            assertNotInternalFile(filePath);
            assertNotSymlinkIfExists(filePath);
            enforceUploadSize(Buffer.byteLength(String(content), "utf-8"));
            fs.writeFileSync(filePath, content, "utf-8");
            return res.json({ message: "File updated successfully" });
        }

        const { target_dir, chunk_index, total_chunks, original_filename, original_size } = req.body;
        const safeDir = safePath(target_dir || BASE_DIR);
        const safeOriginalName = safeName(original_filename, "file name");
        const tempFilePath = safeChildPath(safeDir, `.${safeOriginalName}.part`, "temporary file name");
        const finalFilePath = safeChildPath(safeDir, safeOriginalName, "file name");
        assertNotInternalFile(finalFilePath);
        enforceUploadSize(original_size || req.file?.size || 0);
        if (!req.file) return res.status(400).json({ error: "File chunk is missing" });
        assertNotSymlinkIfExists(tempFilePath);
        assertNotSymlinkIfExists(finalFilePath);

        fs.appendFileSync(tempFilePath, fs.readFileSync(req.file.path));
        fs.unlinkSync(req.file.path);

        if (parseInt(chunk_index) === parseInt(total_chunks) - 1) {
            fs.renameSync(tempFilePath, finalFilePath);
        }

        res.json({ message: "Chunk uploaded successfully", chunk_index });
    } catch (err) {
        console.error("Error handling upload:", err);
        res.status(400).json({ error: err.message });
    }
});

// File download
app.post("/download", (req, res) => {
    try {
        const { target_dir, file_name } = req.body;

        if (!target_dir || !file_name) {
            return res.status(400).json({ error: "target_dir or file_name is missing" });
        }

        const safeDir = safePath(target_dir);
        const safeFileName = safeName(file_name, "file name");
        const filePath = safeChildPath(safeDir, safeFileName, "file name");
        assertNotInternalFile(filePath);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }
        safeLstatSync(filePath);

        res.download(filePath, safeFileName);
    } catch (err) {
        console.error("Error downloading file:", err);
        res.status(400).json({ error: err.message });
    }
});

// POST /download_zip
app.post("/download_zip", zipRateLimit, (req, res) => {
    try {
        const { target_dir } = req.body;

        if (!target_dir) {
            return res.status(400).json({ error: "target_dir is missing" });
        }

        const safeTargetDir = safePath(target_dir);
        assertNotInternalFile(safeTargetDir);

        if (!safeLstatSync(safeTargetDir).isDirectory()) {
            return res.status(400).json({ error: "Specified target is not a directory" });
        }

        streamDirectoryZip(res, safeTargetDir, `${path.basename(safeTargetDir)}.zip`);
    } catch (err) {
        console.error("Error creating ZIP for directory:", err);
        res.status(400).json({ error: err.message });
    }
});

// POST /download_selected_zip
app.post("/download_selected_zip", zipRateLimit, (req, res) => {
    try {
        const { target_dir, items } = req.body;

        if (!target_dir || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "target_dir and items are required" });
        }

        const safeTargetDir = safePath(target_dir);
        const archive = archiver("zip", { zlib: { level: 9 } });

        res.attachment("selected_files.zip");
        res.setHeader("Content-Type", "application/zip");

        archive.on("error", (err) => {
            console.error("Archive error:", err);
            res.status(500).json({ error: "Error creating ZIP file" });
        });

        archive.pipe(res);

        for (const item of items) {
            const itemName = safeName(item, "item name");
            const itemPath = safeChildPath(safeTargetDir, itemName, "item name");
            assertNotInternalFile(itemPath);
            if (!fs.existsSync(itemPath)) continue;
            const stats = safeLstatSync(itemPath);
            if (stats.isDirectory()) {
                addDirectoryToArchive(archive, itemPath, itemName);
            } else {
                archive.file(itemPath, { name: itemName });
            }
        }

        archive.finalize();
    } catch (err) {
        console.error("Error creating ZIP for selected items:", err);
        res.status(400).json({ error: err.message });
    }
});

// POST /delete route
app.post("/delete", async (req, res) => {
    const targetDir = req.body.target_dir || "./data"; // Adjust BASE_DIR
    const items = req.body.items || [];
    const force = req.body.force || false;

    try {
        const safeTargetDir = safePath(targetDir);
        const nonEmptyDirs = [];

        // 1) Verify all items
        for (const item of items) {
            const itemName = safeName(item, "item name");
            const itemPath = safeChildPath(safeTargetDir, itemName, "item name");
            assertNotInternalFile(itemPath);
            if (!fs.existsSync(itemPath)) {
                return res.status(404).json({ error: `Item ${item} not found` });
            }

            if (safeLstatSync(itemPath).isDirectory()) {
                // Check if the directory is empty
                if (fs.readdirSync(itemPath).length > 0) {
                    nonEmptyDirs.push(item);
                }
            }
        }

        // 2) Handle non-empty directories if force is false
        if (nonEmptyDirs.length > 0 && !force) {
            return res.status(400).json({
                error: "DIRECTORIES_NOT_EMPTY",
                dirs: nonEmptyDirs,
            });
        }

        // 3) Delete items
        for (const item of items) {
            const itemName = safeName(item, "item name");
            const itemPath = safeChildPath(safeTargetDir, itemName, "item name");
            assertNotInternalFile(itemPath);

            if (safeLstatSync(itemPath).isDirectory()) {
                // Directory
                if (force) {
                    // Recursive deletion
                    fs.rmSync(itemPath, { recursive: true, force: true });
                } else {
                    // Empty directory
                    fs.rmdirSync(itemPath);
                }
            } else {
                // File
                fs.unlinkSync(itemPath);
            }
        }

        res.json({ message: "Selected items deleted successfully" });
    } catch (err) {
        console.error("Error deleting items:", err);
        res.status(400).json({ error: err.message });
    }
});

// Directory creation
app.post("/create_dir", (req, res) => {
    try {
        const { target_dir = BASE_DIR, dirname } = req.body;

        const safeDir = safePath(target_dir);
        const dirName = safeName(dirname, "directory name");
        const dirPath = safeChildPath(safeDir, dirName, "directory name");

        if (fs.existsSync(dirPath)) {
            return res.status(400).json({ error: "Directory already exists" });
        }

        fs.mkdirSync(dirPath, { recursive: true });
        res.json({ message: "Directory created successfully" });
    } catch (err) {
        console.error("Error creating directory:", err);
        res.status(400).json({ error: err.message });
    }
});

app.get("/", (req, res) => {
    try {
        const files = fs.readdirSync(BASE_DIR).filter(file => {
            return !isGeneratedPasswordPath(path.join(BASE_DIR, file));
        }).map(file => ({
            name: file,
            isDirectory: safeLstatSync(path.join(BASE_DIR, file)).isDirectory(),
        }));

        // Generate a simple HTML response listing the contents
        const html = `
            <h1>Directory Listing</h1>
            <ul>
                ${files.map(file => `
                    <li>
                        <a href="${file.isDirectory ? "/" + file.name : "/" + file.name}">
                            ${file.name} ${file.isDirectory ? "(Folder)" : ""}
                        </a>
                    </li>
                `).join("")}
            </ul>
        `;
        res.send(html);
    } catch (error) {
        console.error("Error listing root folder:", error);
        res.status(500).send("Error listing directory contents.");
    }
});

// Search endpoint
app.post("/search", (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: "Query parameter is required" });
    }

    function calculateDirSize(dir) {
        const items = fs.readdirSync(dir);
        return items.reduce((totalSize, item) => {
            const fullPath = path.join(dir, item);
            const stats = safeLstatSync(fullPath);
            return totalSize + (stats.isDirectory() ? calculateDirSize(fullPath) : stats.size);
        }, 0);
    }

    function searchFiles(directory, searchTerm) {
        let results = [];
        const items = fs.readdirSync(directory, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(directory, item.name);
            if (isGeneratedPasswordPath(fullPath)) continue;
            const stats = safeLstatSync(fullPath);

            if (item.isDirectory()) {
                if (item.name.toLowerCase().includes(searchTerm.toLowerCase())) {
                    results.push({
                        name: item.name,
                        path: fullPath,
                        is_dir: true,
                        size: formatSize(calculateDirSize(fullPath)),
                        last_modified: stats.mtimeMs,
                    });
                }
                results = results.concat(searchFiles(fullPath, searchTerm));
            } else if (item.name.toLowerCase().includes(searchTerm.toLowerCase())) {
                results.push({
                    name: item.name,
                    path: fullPath,
                    is_dir: false,
                    size: formatSize(stats.size),
                    last_modified: stats.mtimeMs,
                });
            }
        }

        return results;
    }

    try {
        const results = searchFiles(BASE_DIR, query);
        res.json(results);
    } catch (error) {
        console.error("Error during search:", error);
        res.status(500).json({ error: "Error during search operation." });
    }
});

// Serve pdf endpoint
app.get("/serve_pdf", (req, res) => {
    try {
        const { target_dir, file_name } = req.query;

        if (!target_dir || !file_name) {
            return res.status(400).send("Missing parameters");
        }

        const safeDir = safePath(target_dir);
        const safeFileName = safeName(file_name, "file name");
        const filePath = safeChildPath(safeDir, safeFileName, "file name");
        assertNotInternalFile(filePath);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }
        safeLstatSync(filePath);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
        res.sendFile(filePath);
    } catch (err) {
        console.error("Error serving PDF:", err);
        res.status(500).send("Failed to serve PDF file");
    }
});

app.get("/serve_image", (req, res) => {
    try {
        const { target_dir, file_name } = req.query;

        if (!target_dir || !file_name) {
            return res.status(400).send("Missing parameters");
        }

        const safeDir = safePath(target_dir);
        const safeFileName = safeName(file_name, "file name");
        const filePath = safeChildPath(safeDir, safeFileName, "file name");
        assertNotInternalFile(filePath);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }
        safeLstatSync(filePath);

        const ext = path.extname(safeFileName).toLowerCase();
        const mimeTypes = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif"
        };
        const contentType = mimeTypes[ext];
        if (!contentType) {
            return res.status(400).send("Unsupported image type");
        }

        res.setHeader("Content-Type", contentType);
        res.sendFile(filePath);
    } catch (err) {
        console.error("Error serving image:", err);
        res.status(500).send("Failed to serve image file");
    }
});

// POST /rename — rename file or folder
app.post("/rename", (req, res) => {
    try {
        const { target_dir, old_name, new_name } = req.body;
        if (!old_name || !new_name)
            return res.status(400).json({ error: "old_name and new_name are required" });
        const safeDir = safePath(target_dir || BASE_DIR);
        const oldName = safeName(old_name, "old name");
        const newName = safeName(new_name, "new name");
        const oldPath = safeChildPath(safeDir, oldName, "old name");
        const newPath = safeChildPath(safeDir, newName, "new name");
        assertNotInternalFile(oldPath);
        assertNotInternalFile(newPath);
        if (!fs.existsSync(oldPath)) return res.status(404).json({ error: "Item not found" });
        safeLstatSync(oldPath);
        assertNotSymlinkIfExists(newPath);
        if (fs.existsSync(newPath)) return res.status(400).json({ error: "An item with that name already exists" });
        fs.renameSync(oldPath, newPath);
        res.json({ message: "Renamed successfully" });
    } catch (err) {
        console.error("Error renaming:", err);
        res.status(400).json({ error: err.message });
    }
});

// POST /share — generate share token (requires auth if auth is enabled)
app.post("/share", shareRateLimit, (req, res) => {
    try {
        const { target_dir, file_name } = req.body;
        if (!target_dir || !file_name)
            return res.status(400).json({ error: "Missing params" });
        const safeDir = safePath(target_dir);
        const safeFileName = safeName(file_name, "file name");
        const filePath = safeChildPath(safeDir, safeFileName, "file name");
        assertNotInternalFile(filePath);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
        const isDirectory = safeLstatSync(filePath).isDirectory();
        const existingShare = findActiveShareToken(filePath, isDirectory);
        const expiresAt = Date.now() + SHARE_TTL_MS;
        const fileName = isDirectory ? `${path.basename(filePath)}.zip` : safeFileName;

        if (existingShare) {
            existingShare.entry.expiresAt = expiresAt;
            existingShare.entry.fileName = fileName;
            return res.json({ token: existingShare.token, expiresAt });
        }

        const token = crypto.randomBytes(32).toString("hex");
        shareTokens.set(token, { filePath, fileName, isDirectory, expiresAt });
        res.json({ token, expiresAt });
    } catch (err) {
        console.error("Error creating share:", err);
        res.status(400).json({ error: err.message });
    }
});

app.use((err, req, res, next) => {
    console.error("Request error:", err);
    res.status(400).json({ error: err.message || "Invalid request" });
});

// Start server
app.listen(3000, () => {
    console.log(`Server running at http://localhost:3000`);
    console.log(`Base directory: ${BASE_DIR}`);
});
