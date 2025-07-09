const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const basicAuth = require("express-basic-auth");
const archiver = require("archiver");

const app = express();
const BASE_DIR = path.resolve(process.env.FILE_SERVER_ROOT || "./data");

const FRONTEND_DIR = path.resolve(__dirname, "../frontend");
app.use(express.static(FRONTEND_DIR));

// Ensure the base directory exists
if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
}

// Middleware for JSON and form parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Helper to validate and resolve safe paths
function safePath(targetPath) {
    const resolvedPath = path.resolve(BASE_DIR, targetPath);
    if (!resolvedPath.startsWith(BASE_DIR)) {
        throw new Error("Access outside the root directory is forbidden.");
    }
    return resolvedPath;
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
            if (!currentDir.startsWith(BASE_DIR)) currentDir = BASE_DIR;
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
            // Use the target directory from the request body or default to BASE_DIR
            const safeDir = safePath(req.body.target_dir || BASE_DIR);
            cb(null, safeDir);
        },
        filename: (req, file, cb) => {
            // Save the file with a unique name to prevent overwriting
            cb(null, `.${file.originalname}.part`);
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
            const filePath = path.join(safeDir, file_name);
            fs.writeFileSync(filePath, content, "utf-8");
            return res.json({ message: "File updated successfully" });
        }

        const { target_dir, chunk_index, total_chunks, original_filename } = req.body;
        const safeDir = safePath(target_dir || BASE_DIR);
        const tempFilePath = path.join(safeDir, `.${original_filename}.part`);

        fs.appendFileSync(tempFilePath, fs.readFileSync(req.file.path));
        fs.unlinkSync(req.file.path);

        if (parseInt(chunk_index) === parseInt(total_chunks) - 1) {
            const finalFilePath = path.join(safeDir, original_filename);
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
        const filePath = path.join(safeDir, file_name);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        res.download(filePath, file_name);
    } catch (err) {
        console.error("Error downloading file:", err);
        res.status(400).json({ error: err.message });
    }
});

// POST /download_zip
app.post("/download_zip", (req, res) => {
    try {
        const { target_dir } = req.body;

        if (!target_dir) {
            return res.status(400).json({ error: "target_dir is missing" });
        }

        const safeTargetDir = safePath(target_dir);

        if (!fs.lstatSync(safeTargetDir).isDirectory()) {
            return res.status(400).json({ error: "Specified target is not a directory" });
        }

        // Create a ZIP file in memory
        const archive = archiver("zip", { zlib: { level: 9 } });
        res.attachment(`${path.basename(safeTargetDir)}.zip`);
        res.setHeader("Content-Type", "application/zip");

        archive.on("error", (err) => {
            console.error("Archive error:", err);
            res.status(500).json({ error: "Error creating ZIP file" });
        });

        archive.pipe(res);

        // Append files to the ZIP
        archive.directory(safeTargetDir, false);

        archive.finalize();
    } catch (err) {
        console.error("Error creating ZIP for directory:", err);
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
            const itemPath = path.join(safeTargetDir, path.basename(item));
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
            const itemPath = path.join(safeTargetDir, path.basename(item));

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

        if (!dirname || dirname.includes("/") || dirname.includes("\\")) {
            return res.status(400).json({ error: "Invalid directory name" });
        }

        const safeDir = safePath(target_dir);
        const dirPath = path.join(safeDir, dirname);

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
        const filePath = path.join(safeDir, file_name);

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

// Start server
app.listen(3000, () => {
    console.log(`Server running at http://localhost:3000`);
    console.log(`Base directory: ${BASE_DIR}`);
});
