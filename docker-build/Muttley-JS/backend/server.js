const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const basicAuth = require("express-basic-auth");
const archiver = require("archiver");
const crypto = require("crypto");

const app = express();
const BASE_DIR = path.resolve(process.env.FILE_SERVER_ROOT || "./data");
const ZIP_RATE_LIMIT_WINDOW_MS = parseInt(process.env.ZIP_RATE_LIMIT_WINDOW_MS || "900000", 10);
const ZIP_RATE_LIMIT_MAX = parseInt(process.env.ZIP_RATE_LIMIT_MAX || "20", 10);
const SHARE_RATE_LIMIT_WINDOW_MS = parseInt(process.env.SHARE_RATE_LIMIT_WINDOW_MS || "900000", 10);
const SHARE_RATE_LIMIT_MAX = parseInt(process.env.SHARE_RATE_LIMIT_MAX || "30", 10);
const PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS = parseInt(process.env.PUBLIC_SHARE_RATE_LIMIT_WINDOW_MS || "900000", 10);
const PUBLIC_SHARE_RATE_LIMIT_MAX = parseInt(process.env.PUBLIC_SHARE_RATE_LIMIT_MAX || "60", 10);

const shareTokens = new Map();
const rateLimitBuckets = new Map();
const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Cleanup expired tokens hourly
setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of shareTokens.entries()) {
        if (now > entry.expiresAt) shareTokens.delete(token);
    }
}, 60 * 60 * 1000);

const FRONTEND_DIR = path.resolve(__dirname, "../frontend");
app.use(express.static(FRONTEND_DIR));

if (process.env.TRUST_PROXY) {
    app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
}

// Ensure the base directory exists
if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
}

// Middleware for JSON and form parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    if (entry.isDirectory) {
        return streamDirectoryZip(res, entry.filePath, entry.fileName);
    }
    res.download(entry.filePath, entry.fileName);
});

// Authentication setup
const USERNAME = process.env.AUTH_USERNAME || null;
const PASSWORD = process.env.AUTH_PASSWORD || null;

if (USERNAME && PASSWORD) {
    app.use(
        basicAuth({
            users: { [USERNAME]: PASSWORD },
            challenge: true,
        })
    );
} else {
    console.log("Authentication is disabled. Running without authentication.");
}

function isInsideBase(resolvedPath) {
    const relative = path.relative(BASE_DIR, resolvedPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Helper to validate and resolve safe paths
function safePath(targetPath = "") {
    const resolvedPath = path.resolve(BASE_DIR, targetPath || "");
    if (!isInsideBase(resolvedPath)) {
        throw new Error("Access outside the root directory is forbidden.");
    }
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
    archive.directory(dirPath, false);
    archive.finalize();
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
                const stats = fs.statSync(fullPath);
                return totalSize + (stats.isDirectory() ? calculateDirSize(fullPath) : stats.size);
            }, 0);
        }

        const items = fs.readdirSync(safeDir).map((item) => {
            const fullPath = path.join(safeDir, item);
            const stats = fs.statSync(fullPath);
            return {
                name: item,
                is_dir: fs.statSync(fullPath).isDirectory(),
                size: stats.isDirectory() ? formatSize(calculateDirSize(fullPath)) : formatSize(stats.size),
                last_modified: fs.statSync(fullPath).mtimeMs,
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
            fs.writeFileSync(filePath, content, "utf-8");
            return res.json({ message: "File updated successfully" });
        }

        const { target_dir, chunk_index, total_chunks, original_filename } = req.body;
        const safeDir = safePath(target_dir || BASE_DIR);
        const safeOriginalName = safeName(original_filename, "file name");
        const tempFilePath = safeChildPath(safeDir, `.${safeOriginalName}.part`, "temporary file name");

        fs.appendFileSync(tempFilePath, fs.readFileSync(req.file.path));
        fs.unlinkSync(req.file.path);

        if (parseInt(chunk_index) === parseInt(total_chunks) - 1) {
            const finalFilePath = safeChildPath(safeDir, safeOriginalName, "file name");
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

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

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

        if (!fs.lstatSync(safeTargetDir).isDirectory()) {
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
            if (!fs.existsSync(itemPath)) continue;
            if (fs.lstatSync(itemPath).isDirectory()) {
                archive.directory(itemPath, itemName);
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
            if (!fs.existsSync(itemPath)) {
                return res.status(404).json({ error: `Item ${item} not found` });
            }

            if (fs.lstatSync(itemPath).isDirectory()) {
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

            if (fs.lstatSync(itemPath).isDirectory()) {
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
        const files = fs.readdirSync(BASE_DIR).map(file => ({
            name: file,
            isDirectory: fs.lstatSync(path.join(BASE_DIR, file)).isDirectory(),
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
            const stats = fs.statSync(fullPath);
            return totalSize + (stats.isDirectory() ? calculateDirSize(fullPath) : stats.size);
        }, 0);
    }

    function searchFiles(directory, searchTerm) {
        let results = [];
        const items = fs.readdirSync(directory, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(directory, item.name);
            const stats = fs.statSync(fullPath);

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

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }

        res.setHeader("Content-Type", "application/pdf");
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

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }

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
        if (!fs.existsSync(oldPath)) return res.status(404).json({ error: "Item not found" });
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
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
        const isDirectory = fs.lstatSync(filePath).isDirectory();
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
