let currentDir = ""; // Declare currentDir
let queuedFiles = [];

async function initialize() {
    try {
        const response = await fetch("/config");
        const data = await response.json();
        currentDir = data.base_dir; // Initialize currentDir
        console.log("Initialized currentDir:", currentDir);
        fetchFiles(); // Fetch initial files
    } catch (error) {
        console.error(`Error initializing: ${error.message}`);
    }
}

async function fetchFiles() {
    try {
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir })
        });
        const data = await response.json();
        renderFiles(data.items); // Render files
    } catch (error) {
        console.error(`Error fetching files: ${error.message}`);
    }
}

async function openEditor(fileName) {
    try {
        const targetDir = currentDir;
        const response = await fetch(`/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_dir: targetDir,
                file_name: fileName
            })
        });

        if (!response.ok) {
            openAlertPopup("Error fetching file content: " + (await response.text()));
            return;
        }

        const fileContent = await response.text();

        // Show the editor popup with the file content
        document.getElementById("editorPopup").style.display = "block";
        document.getElementById("overlay").style.display = "block";
        document.getElementById("fileEditor").value = fileContent;
        document.getElementById("fileEditor").setAttribute("data-filename", fileName);
        document.getElementById("fileEditor").setAttribute("data-target-dir", targetDir);
    } catch (error) {
        console.error("Error opening editor:", error);
        openAlertPopup("Error opening editor: " + error.message);
    }
}


async function saveFile() {
    const fileName = document.getElementById("fileEditor").getAttribute("data-filename");
    const updatedContent = document.getElementById("fileEditor").value;
    const targetDir = currentDir; // Use the current directory from your global variable

    try {
        const response = await fetch(`/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file_name: fileName,
                content: updatedContent,
                target_dir: targetDir // Include target_dir in the request payload
            })
        });

        if (!response.ok) {
            openAlertPopup("Error saving file: " + (await response.text()));
        } else {
            openAlertPopup("File saved successfully!");
            closeEditorPopup();
            fetchFiles(); // Refresh file list
        }
    } catch (error) {
        console.error("Error saving file:", error);
        openAlertPopup("Error saving file: " + error.message);
    }
}

function closeEditorPopup() {
    document.getElementById("editorPopup").style.display = "none";
    document.getElementById("overlay").style.display = "none";
    document.getElementById("fileEditor").value = "";
    document.getElementById("fileEditor").removeAttribute("data-filename");
}

async function navigate(dir) {
    try {
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir + "/" + dir })
        });
        const data = await response.json();
        currentDir = data.current_dir; // Update currentDir
        fetchFiles(); // Refresh files
    } catch (error) {
        console.error(`Error navigating to directory: ${error.message}`);
    }
}

async function goBack() {
    try {
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir, action: "go_back" })
        });
        const data = await response.json();
        currentDir = data.current_dir; // Update currentDir
        fetchFiles(); // Refresh file list
    } catch (error) {
        console.error(`Error going back: ${error.message}`);
    }
}

function toggleSelectAll(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll("tbody#fileTable input[type='checkbox']");
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
}

// Ensure that when individual checkboxes are toggled, the "Select All" checkbox is updated
function updateSelectAllCheckbox() {
    const checkboxes = document.querySelectorAll("tbody#fileTable input[type='checkbox']");
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");

    const allChecked = Array.from(checkboxes).every(checkbox => checkbox.checked);
    const noneChecked = Array.from(checkboxes).every(checkbox => !checkbox.checked);

    // Update the "Select All" checkbox state
    if (allChecked) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (noneChecked) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true; // Show indeterminate state
    }
}

function renderFiles(items) {
    const fileTable = document.getElementById("fileTable");
    fileTable.innerHTML = items.map(item => `
        <tr>
            <td><input type="checkbox" value="${item.name}" onclick="updateSelectAllCheckbox()"></td>
            <td>
                ${item.is_dir 
                    ? `<a href="#" onclick="navigate('${item.name}')" class="directory">${item.name}</a>` 
                    : `<span class="filename">${item.name}</span>`}
            </td>
            <td>${item.size || "--"}</td>
            <td>${new Date(item.last_modified * 1000).toLocaleString()}</td>
            <td>
                ${!item.is_dir && item.name.endsWith(".txt") 
                    ? `<button class="button" onclick="openEditor('${item.name}')">Edit</button>` 
                    : ""
                }
                ${item.is_dir 
                    ? `<button class="button" onclick="downloadDirectoryAsZip('${currentDir}/${item.name}')">Download as ZIP</button>` 
                    : `<button class="button" onclick="downloadItem('${item.name}')">Download</button>`
                }  
                <button class="button" onclick="deleteItem('${item.name}')">Delete</button>
            </td>
        </tr>
    `).join("");

    updateSelectAllCheckbox(); // Ensure the "Select All" checkbox state is updated
}

async function downloadDirectoryAsZip(targetDir) {
    try {
        const response = await fetch(`/download_zip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_dir: targetDir
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            openAlertPopup("Error downloading directory: " + errorText);
            return;
        }

        // Create a Blob from the response
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        // Create a temporary link to trigger the download
        const link = document.createElement("a");
        link.href = url;
        link.download = `${targetDir.split('/').pop()}.zip`; // Set ZIP file name
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error downloading directory:", error);
        openAlertPopup("Error downloading directory: " + error.message);
    }
}

function openUploadPopup() {
    document.getElementById("uploadPopup").style.display = "block";
    document.getElementById("overlay").style.display = "block";
    document.getElementById("targetDir").value = currentDir;

    // Clear file input and queued files on opening the popup
    document.getElementById("uploadFile").value = ""; // Reset file input
    queuedFiles = []; // Clear the queue
    updateFileListPreview(); // Clear preview list
}

function closeUploadPopup() {
    document.getElementById("uploadPopup").style.display = "none";
    document.getElementById("overlay").style.display = "none";
    document.getElementById("uploadForm").reset();
    queuedFiles = []; // Clear queue on close
    updateFileListPreview(); // Clear preview list
}

function openCreateDirPopup() {
    document.getElementById("createDirPopup").style.display = "block";
    document.getElementById("overlay").style.display = "block";
}

function closeCreateDirPopup() {
    document.getElementById("createDirPopup").style.display = "none";
    document.getElementById("overlay").style.display = "none";
    document.getElementById("createDirForm").reset();
}

function openAlertPopup(message) {
    const alertPopup = document.getElementById("alertPopup");
    const overlay = document.getElementById("overlay");
    const alertMessage = document.getElementById("alertMessage");
    const okBtn = document.getElementById("alertOkBtn");

    alertMessage.textContent = message;

    // Show the popup & overlay
    alertPopup.style.display = "block";
    overlay.style.display = "block";

    // Reset any previous onclick
    okBtn.onclick = null;
    okBtn.onclick = () => closeAlertPopup();
}

function closeAlertPopup() {
    const alertPopup = document.getElementById("alertPopup");
    const overlay = document.getElementById("overlay");
    const alertMessage = document.getElementById("alertMessage");

    alertPopup.style.display = "none";
    overlay.style.display = "none";
    alertMessage.textContent = "";
}

function openConfirmPopup(message, onYes, onNo) {
    const confirmPopup = document.getElementById("confirmPopup");
    const overlay = document.getElementById("overlay");
    const confirmMessage = document.getElementById("confirmMessage");
    const yesBtn = document.getElementById("confirmYesBtn");
    const noBtn = document.getElementById("confirmNoBtn");

    confirmMessage.textContent = message;

    // Show the popup & overlay
    confirmPopup.style.display = "block";
    overlay.style.display = "block";

    // Reset any previous onclick
    yesBtn.onclick = null;
    noBtn.onclick = null;

    // Attach new callbacks
    yesBtn.onclick = () => {
        closeConfirmPopup();
        if (onYes) onYes();
    };
    noBtn.onclick = () => {
        closeConfirmPopup();
        if (onNo) onNo();
    };
}

function closeConfirmPopup() {
    const confirmPopup = document.getElementById("confirmPopup");
    const overlay = document.getElementById("overlay");
    const confirmMessage = document.getElementById("confirmMessage");

    confirmPopup.style.display = "none";
    overlay.style.display = "none";
    confirmMessage.textContent = "";
}

document.getElementById("createDirForm").addEventListener("submit", async event => {
    event.preventDefault();
    const dirname = document.getElementById("dirname").value;
    try {
        await fetch("/create_dir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_dir: currentDir, dirname })
        });
        closeCreateDirPopup();
        fetchFiles();
    } catch (error) {
        console.error(`Error creating directory: ${error.message}`);
    }
});


async function deleteSelected() {
    // 1. Get the list of selected items
    const selectedCheckboxes = Array.from(document.querySelectorAll("tbody#fileTable input[type='checkbox']:checked"));
    if (selectedCheckboxes.length === 0) {
        openAlertPopup("No items selected for deletion.");
        return;
    }

    const itemsToDelete = Array.from(selectedCheckboxes).map(cb => cb.value);

    try {
        // 2. Send the initial delete request (force = false)
        let response = await fetch("/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_dir: currentDir,
                items: itemsToDelete,
                force: false
            })
        });

        let data = await response.json();

        // 3. Check response for "DIRECTORIES_NOT_EMPTY"
        if (!response.ok && data.error === "DIRECTORIES_NOT_EMPTY") {
            const nonEmptyDirs = data.dirs; // array of non-empty directory names

            const message = 
                "The following directories are not empty:\n" +
                nonEmptyDirs.join(", ") + 
                "\nDo you want to delete them anyway?";

            document.getElementById("confirmMessage").textContent = message;

            // Show confirm popup (Yes/No)
            openConfirmPopup(
                message,
                async () => {
                    // onYes callback
                    const secondResponse = await fetch("/delete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            target_dir: currentDir,
                            items: itemsToDelete,
                            force: true
                        })
                    });
                    const secondData = await secondResponse.json();

                    if (!secondResponse.ok) {
                        // Show an alert popup for error
                        openAlertPopup("Error forcing deletion: " + secondData.error);
                    } else {
                        openAlertPopup("All selected items (including non-empty directories) have been deleted.");
                    }
                    // Refresh the file list
                    fetchFiles();
                },
                () => {
                    // onNo callback
                    openAlertPopup("Deletion was canceled by the user.");
                    // Refresh the file list
                    fetchFiles();
                }
            );
        }
        else if (!response.ok) {
            // Some other error => show alert popup
            openAlertPopup("Error during deletion: " + data.error);
            fetchFiles();
        }
        else {
            // 4. If no error => everything was deleted
            openAlertPopup("Selected items have been successfully deleted.");
            fetchFiles();
        }

    } catch (err) {
        console.error("Error during deletion:", err);
        openAlertPopup("Error during deletion: " + err.message);
    }
}

async function navigateToRoot() {
    try {
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir, action: "go_root" })
        });
        const data = await response.json();
        currentDir = data.current_dir; // Update currentDir
        fetchFiles(); // Refresh file list
    } catch (error) {
        console.error(`Error going root: ${error.message}`);
    }
}

document.getElementById("uploadFile").addEventListener("change", (event) => {
    const files = Array.from(event.target.files);

    files.forEach(file => {
        // Avoid duplicates
        if (!queuedFiles.some(queuedFile => queuedFile.name === file.name)) {
            queuedFiles.push(file);
        }
    });

    // Update file list preview
    updateFileListPreview();
});

document.getElementById("uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData();

    // Add all queued files to FormData
    queuedFiles.forEach(file => {
        formData.append("file", file); // Attach files with their filenames
    });

    // Add the target directory
    formData.append("target_dir", document.getElementById("targetDir").value);

    openAlertPopup("Uploading files, please wait...");

    try {
        const response = await fetch("/upload", { method: "POST", body: formData });

        if (!response.ok) {
            const errorText = await response.text();
            openAlertPopup("Error during upload: " + errorText);
            return;
        }

        openAlertPopup("Files uploaded successfully!");
    } catch (error) {
        console.error("Error during upload:", error);
        openAlertPopup("Unexpected error during upload: " + error.message);
    } finally {
        closeUploadPopup();
        fetchFiles(); // Refresh file list
    }
});

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    const dropZone = document.getElementById("dropZone");
    dropZone.classList.add("dragover");
}

function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    const dropZone = document.getElementById("dropZone");
    dropZone.classList.remove("dragover");

    const files = Array.from(event.dataTransfer.files);

    // Append files to the queuedFiles array
    files.forEach(file => {
        if (!queuedFiles.some(queuedFile => queuedFile.name === file.name)) {
            queuedFiles.push(file);
        }
    });

    // Update the FormData used in the submission
    const formData = new FormData(document.getElementById("uploadForm"));
    queuedFiles.forEach(file => {
        formData.append("file", file);
    });

    // Update the preview list
    updateFileListPreview();
}

function updateFileListPreview() {
    const fileListPreview = document.getElementById("fileListPreview");
    fileListPreview.innerHTML = queuedFiles
        .map(file => `<li>${file.name} (${(file.size / 1024).toFixed(1)} KB)</li>`)
        .join("");
}

document.getElementById("dropZone").addEventListener("dragover", handleDragOver);
document.getElementById("dropZone").addEventListener("dragleave", () => {
    document.getElementById("dropZone").classList.remove("dragover");
});
document.getElementById("dropZone").addEventListener("drop", handleDrop);

async function deleteItem(fileName) {
    try {
        // 1. First request (force = false)
        let response = await fetch("/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_dir: currentDir,
                items: [fileName],
                force: false
            })
        });

        let data = await response.json();

        // 2. Check if the request failed because directory is not empty
        if (!response.ok && data.error === "DIRECTORIES_NOT_EMPTY") {
            // Typically data.dirs = [fileName] in this case
            const nonEmptyDir = data.dirs[0] || fileName;
            
            // Build a message for the confirm popup
            const message = 
                `The directory "${nonEmptyDir}" is not empty.\n` +
                `Do you want to delete it anyway?`;

            // 3. Show a "Yes/No" confirm popup
            openConfirmPopup(
                message,
                async () => {
                    // onYes callback: try forced deletion
                    const forceResponse = await fetch("/delete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            target_dir: currentDir,
                            items: [fileName],
                            force: true
                        })
                    });
                    const forceData = await forceResponse.json();

                    if (!forceResponse.ok) {
                        // Show an alert popup for error
                        openAlertPopup("Error forcing deletion: " + forceData.error);
                    } else {
                        openAlertPopup(`"${fileName}" has been deleted (including its contents).`);
                    }
                    fetchFiles();
                },
                () => {
                    // onNo callback: user canceled
                    openAlertPopup("Deletion was canceled by the user.");
                    fetchFiles();
                }
            );
        }
        else if (!response.ok) {
            // 4. Some other error: show an alert popup
            openAlertPopup("Error deleting: " + data.error);
            fetchFiles();
        }
        else {
            // 5. Success: item was deleted (file or empty directory)
            openAlertPopup(`"${fileName}" has been successfully deleted.`);
            fetchFiles();
        }

    } catch (error) {
        console.error(`Error deleting file: ${error.message}`);
        openAlertPopup("Unexpected error: " + error.message);
    }
}


async function downloadItem(fileName) {
    try {
        const loadingMessage = "Preparing your download, please wait...";
        openAlertPopup(loadingMessage);

        const response = await fetch(`/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_dir: currentDir,
                file_name: fileName
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            openAlertPopup("Error downloading file: " + errorText);
            return;
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        closeAlertPopup();  // Close loading popup
    } catch (error) {
        console.error("Error downloading file:", error);
        openAlertPopup("Error downloading file: " + error.message);
    }
}


// Initialize on page load
initialize();
