let currentDir = ""; // Declare currentDir
let queuedFiles = [];

let sortState = {
    column: null,
    direction: 'asc'
};

function parseSizeToBytes(sizeString) {
    if (!sizeString || sizeString === "--") return 0; // Treat missing sizes as 0 bytes

    const units = ["B", "KB", "MB", "GB", "TB"];
    const [value, unit] = sizeString.split(" ");
    const multiplier = Math.pow(1024, units.indexOf(unit));
    return parseFloat(value) * multiplier;
}

function sortTable(column) {
    const fileTableBody = document.getElementById("fileTable");
    let rows;

    if (isSearchActive) {
        // If a search is active, use the current search results
        rows = currentSearchResults.map((item) => {
            const row = document.createElement("tr");
            row.setAttribute("data-last-modified", item.last_modified || "");
            row.innerHTML = `
                <td><input type="checkbox" value="${item.name}" onclick="updateSelectAllCheckbox()"></td>
                <td class="name">
                    ${
                        item.is_dir
                            ? `<a href="#" onclick="navigate('${item.name}')" class="directory">${item.name}</a>`
                            : `<span class="filename">${item.name}</span>`
                    }
                </td>
                <td class="size">${item.size || "--"}</td>
                <td class="last_modified">${item.last_modified ? formatDate(item.last_modified) : "--"}</td>
                <td>
                    ${
                        !item.is_dir && item.name.endsWith(".txt")
                            ? `<button class="button" data-filename="${item.name}" onclick="openEditor('${item.name.replace(/'/g, "\\'")}')">Edit</button>`
                            : ""
                    }
                    ${
                        !item.is_dir && item.name.endsWith(".pdf")
                            ? `<button class="button" data-filename="${item.name}" onclick="previewPdf('${item.name.replace(/'/g, "\\'")}')">Preview</button>`
                            : ""
                    }                    
                    ${
                        item.is_dir
                            ? `<button class="button" data-filename="${item.name}" onclick="downloadDirectoryAsZip(this.dataset.filename)">Download as ZIP</button>`
                            : `<button class="button" data-filename="${item.name}" onclick="downloadItem(this.dataset.filename)">Download</button>`
                    }  
                    <button class="button" data-filename="${item.name}" onclick="deleteItem(this.dataset.filename)">Delete</button>
                </td>
            `;
            return row;
        });
    } else {
        // If no search is active, use the current directory rows
        rows = Array.from(fileTableBody.rows);
    }

    // Cycle through states: unsorted -> ascending -> descending -> unsorted
    if (sortState.column === column) {
        if (sortState.direction === "asc") {
            sortState.direction = "desc";
        } else if (sortState.direction === "desc") {
            sortState.direction = "unsorted";
        } else {
            sortState.direction = "asc";
        }
    } else {
        sortState = { column, direction: "asc" };
    }

    // Handle unsorted state
    if (sortState.direction === "unsorted") {
        if (isSearchActive) {
            renderSearchResults(currentSearchResults); // Re-render the search results unsorted
        } else {
            fetchFiles(); // Fetch and render the initial directory list
        }
        updateSortArrows(column);
        return;
    }

    // Sorting logic
    rows.sort((a, b) => {
        let aValue, bValue;

        if (column === "size") {
            aValue = parseSizeToBytes(
                a.querySelector(`.${column}`)?.textContent.trim()
            );
            bValue = parseSizeToBytes(
                b.querySelector(`.${column}`)?.textContent.trim()
            );
        } else if (column === "last_modified") {
            aValue = parseInt(a.getAttribute("data-last-modified"), 10);
            bValue = parseInt(b.getAttribute("data-last-modified"), 10);
        } else if (column === "name") {
            aValue = a.querySelector(".name").textContent.trim().toLowerCase();
            bValue = b.querySelector(".name").textContent.trim().toLowerCase();
        } else {
            return 0; // Non-sortable columns
        }

        return sortState.direction === "asc"
            ? aValue > bValue
                ? 1
                : -1
            : aValue < bValue
            ? 1
            : -1;
    });

    // Update the DOM with sorted rows
    fileTableBody.innerHTML = ""; // Clear existing rows
    rows.forEach((row) => fileTableBody.appendChild(row)); // Append sorted rows

    // Update the sorting arrow indicators
    updateSortArrows(column);
}


function updateSortArrows(column) {
    const columns = ["name", "size", "last_modified"];
    columns.forEach((col) => {
        const arrowElement = document.getElementById(`${col}SortArrow`);
        if (col === column) {
            if (sortState.direction === "asc") {
                arrowElement.textContent = "⬆";
            } else if (sortState.direction === "desc") {
                arrowElement.textContent = "⬇";
            } else {
                arrowElement.textContent = "⬍"; // Reset to unsorted state
            }
        } else {
            arrowElement.textContent = "⬍"; // Reset other columns to unsorted
        }
    });
}

function formatDate(timestamp) {
    const date = new Date(Math.floor(timestamp)); // Truncate fractional part
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

async function performSearch() {
    const searchInput = document.getElementById("searchInput");
    const query = searchInput.value.trim();

    try {
        if (!query) {
            // Reset to the directory list if the search is empty
            isSearchActive = false;
            fetchFiles();
        } else {
            // Perform a search
            const response = await fetch("/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const results = await response.json();
            currentSearchResults = results; // Save the search results
            isSearchActive = true; // Indicate search is active
            renderSearchResults(results); // Render search results
        }
    } catch (error) {
        openAlertPopup("Error during search: " + error.message);
    } finally {
        searchInput.value = ""; // Clear the search input
    }
}

document.getElementById("searchInput").addEventListener("keypress", function (event) {
    if (event.key === "Enter") {
        event.preventDefault(); // Prevent default form submission
        performSearch(); // Trigger the search button click
    }
});

function renderSearchResults(results) {
    const fileTable = document.getElementById("fileTable");

    if (results.length === 0) {
        fileTable.innerHTML = `<tr><td colspan="5">No files or directories found matching the search term.</td></tr>`;
        return;
    }

    fileTable.innerHTML = results
        .map(
            (item) => `
        <tr data-last-modified="${item.last_modified || ''}">
            <td><input type="checkbox" value="${item.name}" onclick="updateSelectAllCheckbox()"></td>
            <td class="name">
                ${
                    item.is_dir
                        ? `<a href="#" onclick="navigate('${item.name}')" class="directory">${item.name}</a>`
                        : `<span class="filename">${item.name}</span>`
                }
            </td>
            <td class="size">${item.size || "--"}</td>
            <td class="last_modified">${item.last_modified ? formatDate(item.last_modified) : "--"}</td>
            <td>
                ${
                    !item.is_dir && item.name.endsWith(".txt")
                        ? `<button class="button" data-filename="${item.name}" onclick="openEditor('${item.name.replace(/'/g, "\\'")}')">Edit</button>`
                        : ""
                }
                ${
                    !item.is_dir && item.name.endsWith(".pdf")
                        ? `<button class="button" data-filename="${item.name}" onclick="previewPdf('${item.name.replace(/'/g, "\\'")}')">Preview</button>`
                        : ""
                }
                ${
                    item.is_dir
                        ? `<button class="button" data-filename="${item.name}" onclick="downloadDirectoryAsZip(this.dataset.filename)">Download as ZIP</button>`
                        : `<button class="button" data-filename="${item.name}" onclick="downloadItem(this.dataset.filename)">Download</button>`
                }  
                <button class="button" data-filename="${item.name}" onclick="deleteItem(this.dataset.filename)">Delete</button>
            </td>
        </tr>
    `
        )
        .join("");

    updateSelectAllCheckbox(); // Ensure the "Select All" checkbox state is updated
}

async function initialize() {
    try {
        const response = await fetch("/config");
        const data = await response.json();
        currentDir = data.base_dir; // Initialize currentDir
        fetchFiles(); // Fetch initial files
    } catch (error) {
    }
}

async function fetchFiles() {
    try {
        isSearchActive = false; // Reset search state
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir })
        });
        const data = await response.json();
        renderFiles(data.items); // Render files
    } catch (error) {
        console.error("Error fetching files:", error);
    }
}

document.getElementById("overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      closeUploadPopup();
      closeCreateDirPopup();
      closeConfirmPopup();
      closeAlertPopup();
      closeEditorPopup();
    }
});

function previewPdf(fileName) {
    const iframe = document.getElementById("pdfIframe");
    const popup = document.getElementById("pdfPreviewPopup");
    const overlay = document.getElementById("overlay");

    const pdfUrl = `/serve_pdf?target_dir=${encodeURIComponent(currentDir)}&file_name=${encodeURIComponent(fileName)}`;
    iframe.src = pdfUrl;

    popup.style.display = "block";
    overlay.style.display = "block";
}

function closePdfPreview() {
    const popup = document.getElementById("pdfPreviewPopup");
    const overlay = document.getElementById("overlay");
    const iframe = document.getElementById("pdfIframe");

    popup.style.display = "none";
    overlay.style.display = "none";
    iframe.src = ""; // Clean iframe src
}

async function openEditor(fileName) {
    try {
      const targetDir = currentDir;
      const response = await fetch(`/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_dir: targetDir, file_name: fileName })
      });
  
      if (!response.ok) {
        openAlertPopup("Error fetching file content: " + (await response.text()));
        return;
      }
  
      const fileContent = await response.text();
  
      const popup = document.getElementById("editorPopup");
      const overlay = document.getElementById("overlay");
      const editor = document.getElementById("fileEditor");
  
      editor.value = fileContent;
      editor.setAttribute("data-filename", fileName);
      editor.setAttribute("data-target-dir", targetDir);
  
      popup.classList.add("is-open");   // ✅ show via class
      overlay.style.display = "block";
    } catch (error) {
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
        openAlertPopup("Error saving file: " + error.message);
    }
}

function closeEditorPopup() {
    const popup = document.getElementById("editorPopup");
    const overlay = document.getElementById("overlay");
    const editor = document.getElementById("fileEditor");
  
    popup.classList.remove("is-open");  // ✅ hide via class
    overlay.style.display = "none";
    editor.value = "";
    editor.removeAttribute("data-filename");
    editor.removeAttribute("data-target-dir");
}

async function navigate(dir) {
    try {
        isSearchActive = false; // Reset search state
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: `${currentDir}/${dir}` })
        });
        const data = await response.json();
        currentDir = data.current_dir; // Update currentDir
        fetchFiles(); // Refresh files
    } catch (error) {
        console.error("Error navigating to directory:", error);
    }
}

async function goBack() {
    try {
        isSearchActive = false; // Reset search state
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir, action: "go_back" })
        });
        const data = await response.json();
        currentDir = data.current_dir; // Update currentDir
        fetchFiles(); // Refresh file list
    } catch (error) {
        console.error("Error going back:", error);
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
    fileTable.innerHTML = items
        .map(
            (item) => `
        <tr data-last-modified="${item.last_modified}">
            <td><input type="checkbox" value="${item.name}" onclick="updateSelectAllCheckbox()"></td>
            <td class="name">
                ${
                    item.is_dir
                        ? `<a href="#" onclick="navigate('${item.name}')" class="directory">${item.name}</a>`
                        : `<span class="filename">${item.name}</span>`
                }
            </td>
            <td class="size">${item.size || "--"}</td>
            <td class="last_modified">${formatDate(item.last_modified)}</td>
            <td>
                ${
                    !item.is_dir && item.name.endsWith(".txt")
                        ? `<button class="button" data-filename="${item.name}" onclick="openEditor('${item.name.replace(/'/g, "\\'")}')">Edit</button>`
                        : ""
                }
                ${
                    !item.is_dir && item.name.endsWith(".pdf")
                        ? `<button class="button" data-filename="${item.name}" onclick="previewPdf('${item.name.replace(/'/g, "\\'")}')">Preview</button>`
                        : ""
                }
                ${
                    item.is_dir
                        ? `<button class="button" data-filename="${currentDir}/${item.name}" onclick="downloadDirectoryAsZip(this.dataset.filename)">Download as ZIP</button>`
                        : `<button class="button" data-filename="${item.name}" onclick="downloadItem(this.dataset.filename)">Download</button>`
                }  
                <button class="button" data-filename="${item.name}" onclick="deleteItem(this.dataset.filename)">Delete</button>
            </td>
        </tr>
    `
        )
        .join("");

    updateSelectAllCheckbox(); // Ensure the "Select All" checkbox state is updated
}

async function downloadDirectoryAsZip(targetDir) {
    const loadingMessage = "Preparing your download, please wait...";
    openAlertPopup(loadingMessage); // Display loading message

    try {
        // Create a temporary form element
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/download_zip"; // The endpoint URL

        // Create a hidden input field for the payload
        const targetDirInput = document.createElement("input");
        targetDirInput.type = "hidden";
        targetDirInput.name = "target_dir";
        targetDirInput.value = targetDir;

        // Append the input to the form
        form.appendChild(targetDirInput);

        // Append the form to the document body and submit it
        document.body.appendChild(form);
        form.submit();

        // Remove the form after submission
        document.body.removeChild(form);

        closeAlertPopup(); // Close the loading message after the form submission
    } catch (error) {
        openAlertPopup("Error initiating directory download: " + error.message);
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
        openAlertPopup("Error during deletion: " + err.message);
    }
}

async function navigateToRoot() {
    try {
        isSearchActive = false; // Reset search state
        const response = await fetch("/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_dir: currentDir, action: "go_root" })
        });
        const data = await response.json();
        currentDir = data.current_dir; // Update currentDir
        fetchFiles(); // Refresh file list
    } catch (error) {
        console.error("Error navigating to root directory:", error);
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

function showProgressBar() {
    const progressBar = document.getElementById("uploadProgressBar");
    if (progressBar) {
        progressBar.style.display = "block";
    }
}

function hideProgressBar() {
    const progressBar = document.getElementById("uploadProgressBar");
    if (progressBar) {
        progressBar.style.display = "none";
        progressBar.value = 0; // Reset progress
    }
}

async function uploadFileInChunks(file, targetDir) {
    const chunkSize = 5 * 1024 * 1024; // 5 MB
    const totalChunks = Math.ceil(file.size / chunkSize);

    const progressBar = document.getElementById("uploadProgressBar");
    if (progressBar) {
        progressBar.max = totalChunks;
        progressBar.value = 0;
    }

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const chunk = file.slice(
            chunkIndex * chunkSize,
            (chunkIndex + 1) * chunkSize
        );

        const formData = new FormData();
        formData.append("file", chunk);
        formData.append("chunk_index", chunkIndex);
        formData.append("total_chunks", totalChunks);
        formData.append("original_filename", file.name);
        formData.append("target_dir", targetDir);

        try {
            const response = await fetch("/upload", { method: "POST", body: formData });
            if (!response.ok) {
                throw new Error(await response.text());
            }

            // Update progress bar
            if (progressBar) {
                progressBar.value = chunkIndex + 1;
            }
        } catch (error) {
            throw error; // Stop further uploads on failure
        }
    }
}


document.getElementById("uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showProgressBar();

    const targetDir = document.getElementById("targetDir").value;

    // Check if there are queued files
    if (queuedFiles.length === 0) {
        openAlertPopup("No files selected for upload.");
        return;
    }

    try {
        // Upload each file in chunks
        for (const file of queuedFiles) {
            await uploadFileInChunks(file, targetDir); // Use the new function
        }

        openAlertPopup("All files uploaded successfully!");
    } catch (error) {
        openAlertPopup("Error during file upload: " + error.message);
    } finally {
        hideProgressBar();
        closeUploadPopup();
        fetchFiles(); // Refresh the file list
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
        openAlertPopup("Unexpected error: " + error.message);
    }
}

async function downloadItem(fileName) {
    const loadingMessage = "Preparing your download, please wait...";
    openAlertPopup(loadingMessage); // Display loading message

    try {
        // Create a temporary form element
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/download"; // The endpoint URL

        // Create hidden input fields for the payload
        const targetDirInput = document.createElement("input");
        targetDirInput.type = "hidden";
        targetDirInput.name = "target_dir";
        targetDirInput.value = currentDir;

        const fileNameInput = document.createElement("input");
        fileNameInput.type = "hidden";
        fileNameInput.name = "file_name";
        fileNameInput.value = fileName;

        // Append inputs to the form
        form.appendChild(targetDirInput);
        form.appendChild(fileNameInput);

        // Append the form to the document body and submit it
        document.body.appendChild(form);
        form.submit();

        // Remove the form after submission
        document.body.removeChild(form);

        closeAlertPopup(); // Close the loading message after the form submission
    } catch (error) {
        openAlertPopup("Error initiating file download: " + error.message);
    }
}


// Initialize on page load
initialize();
