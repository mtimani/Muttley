let currentDir = "";
let queuedFiles = [];
let isSearchActive = false;
let currentSearchResults = [];
let currentItems = [];  // full item data cache for grid sorting
let renameTarget = null;
let baseDir = "";
let currentView = localStorage.getItem('muttley-view') || 'list';
let pageDragDepth = 0;
let currentImagePreviewName = null;
let uploadStatus = new Map();

let sortState = {
    column: localStorage.getItem('muttley-sort-column') || null,
    direction: localStorage.getItem('muttley-sort-direction') || 'asc'
};

/* ============================================================
   THEME
   ============================================================ */
function refreshFiles() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.remove('spinning');
    void icon.offsetWidth; // reflow to restart animation
    icon.classList.add('spinning');
    icon.addEventListener('animationend', () => icon.classList.remove('spinning'), { once: true });
    fetchFiles();
}

function initTheme() {
    const saved = localStorage.getItem('muttley-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('themeIcon').className = saved === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('muttley-theme', next);
    document.getElementById('themeIcon').className = next === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

/* ============================================================
   VIEW TOGGLE (list / grid)
   ============================================================ */
function initView() {
    applyView(currentView);
}

function toggleView() {
    currentView = currentView === 'list' ? 'grid' : 'list';
    localStorage.setItem('muttley-view', currentView);
    applyView(currentView);
}

function applyView(view) {
    const listEl   = document.getElementById('listContainer');
    const gridEl   = document.getElementById('gridContainer');
    const sortBar  = document.getElementById('gridSortBar');
    const icon     = document.getElementById('viewIcon');
    if (view === 'grid') {
        listEl.style.display = 'none';
        gridEl.classList.add('active');
        if (sortBar) sortBar.classList.add('active');
        icon.className = 'fa-solid fa-list';
    } else {
        listEl.style.display = '';
        gridEl.classList.remove('active');
        if (sortBar) sortBar.classList.remove('active');
        icon.className = 'fa-solid fa-grip';
    }
}

/* ============================================================
   FILE TYPE ICONS
   ============================================================ */
function getFileTypeIcon(name, isDir) {
    if (isDir) return '<i class="fa-solid fa-folder file-icon dir"></i>';
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext))
        return '<i class="fa-solid fa-file-image file-icon" style="color:#10b981;"></i>';
    if (ext === 'pdf')
        return '<i class="fa-solid fa-file-pdf file-icon" style="color:#ef4444;"></i>';
    if (['txt','md','log','csv','json','xml','yaml','yml'].includes(ext))
        return '<i class="fa-solid fa-file-lines file-icon" style="color:#6366f1;"></i>';
    if (['zip','tar','gz','7z','rar'].includes(ext))
        return '<i class="fa-solid fa-file-zipper file-icon" style="color:#f97316;"></i>';
    if (['mp4','mkv','avi','mov','webm'].includes(ext))
        return '<i class="fa-solid fa-file-video file-icon" style="color:#8b5cf6;"></i>';
    if (['mp3','wav','flac','aac'].includes(ext))
        return '<i class="fa-solid fa-file-audio file-icon" style="color:#06b6d4;"></i>';
    if (['js','ts','py','java','c','cpp','h','cs','php','rb','go','rs','sh'].includes(ext))
        return '<i class="fa-solid fa-file-code file-icon" style="color:#f59e0b;"></i>';
    return '<i class="fa-solid fa-file file-icon"></i>';
}

function getGridCardIcon(name, isDir) {
    if (isDir) return '<i class="fa-solid fa-folder card-icon dir"></i>';
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) return null; // uses thumbnail
    if (ext === 'pdf')  return '<i class="fa-solid fa-file-pdf card-icon pdf"></i>';
    if (['txt','md','log','csv','json','xml','yaml','yml'].includes(ext))
        return '<i class="fa-solid fa-file-lines card-icon text"></i>';
    if (['zip','tar','gz','7z','rar'].includes(ext))
        return '<i class="fa-solid fa-file-zipper card-icon zip"></i>';
    if (['mp4','mkv','avi','mov','webm'].includes(ext))
        return '<i class="fa-solid fa-file-video card-icon video"></i>';
    if (['mp3','wav','flac','aac'].includes(ext))
        return '<i class="fa-solid fa-file-audio card-icon audio"></i>';
    if (['js','ts','py','java','c','cpp','h','cs','php','rb','go','rs','sh'].includes(ext))
        return '<i class="fa-solid fa-file-code card-icon code"></i>';
    return '<i class="fa-solid fa-file card-icon default"></i>';
}

/* ============================================================
   ACTION BUTTONS
   ============================================================ */
function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
function escapeJs(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const iconByType = {
        success: "fa-circle-check",
        error: "fa-circle-exclamation",
        info: "fa-circle-info"
    };
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = document.createElement("i");
    icon.className = `fa-solid ${iconByType[type] || iconByType.info}`;
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(icon, text);
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5200);
}

function selectNameWithoutExtension(input) {
    const value = input.value;
    const dot = value.lastIndexOf(".");
    const end = dot > 0 ? dot : value.length;
    input.setSelectionRange(0, end);
}

function saveSortPreference() {
    if (sortState.column && sortState.direction !== "unsorted") {
        localStorage.setItem("muttley-sort-column", sortState.column);
        localStorage.setItem("muttley-sort-direction", sortState.direction);
    } else {
        localStorage.removeItem("muttley-sort-column");
        localStorage.removeItem("muttley-sort-direction");
    }
}

function getVisibleItems() {
    return isSearchActive ? currentSearchResults : currentItems;
}

function getExistingNames() {
    return new Set(currentItems.map(item => item.name));
}

function getUniqueFileName(name, existingNames) {
    if (!existingNames.has(name)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let index = 1;
    let next = `${base} (${index})${ext}`;
    while (existingNames.has(next)) {
        index += 1;
        next = `${base} (${index})${ext}`;
    }
    return next;
}

function copyFileWithName(file, name) {
    return new File([file], name, {
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified || Date.now()
    });
}

function buildActionsHtml(item) {
    const jsName  = escapeJs(item.name);
    let btns = '';
    if (!item.is_dir && isImageFile(item.name))
        btns += `<button class="btn-action" title="Preview" onclick="event.stopPropagation();previewImage('${jsName}')"><i class="fa-solid fa-eye"></i></button>`;
    if (!item.is_dir && item.name.toLowerCase().endsWith('.pdf'))
        btns += `<button class="btn-action" title="Preview" onclick="event.stopPropagation();previewPdf('${jsName}')"><i class="fa-solid fa-eye"></i></button>`;
    if (!item.is_dir && item.name.toLowerCase().endsWith('.txt'))
        btns += `<button class="btn-action" title="Edit" onclick="event.stopPropagation();openEditor('${jsName}')"><i class="fa-solid fa-pencil"></i></button>`;
    btns += `<button class="btn-action" title="Rename" onclick="event.stopPropagation();openRenamePopup('${jsName}')"><i class="fa-solid fa-i-cursor"></i></button>`;
    btns += `<button class="btn-action" title="Share" onclick="event.stopPropagation();shareItem('${jsName}',${item.is_dir})"><i class="fa-solid fa-share-nodes"></i></button>`;
    if (item.is_dir) {
        const dirPath = escapeJs(`${currentDir}/${item.name}`);
        btns += `<button class="btn-action" title="Download" onclick="event.stopPropagation();downloadDirectoryAsZip('${dirPath}')"><i class="fa-solid fa-download"></i></button>`;
    } else {
        btns += `<button class="btn-action" title="Download" onclick="event.stopPropagation();downloadItem('${jsName}')"><i class="fa-solid fa-download"></i></button>`;
    }
    btns += `<button class="btn-action danger" title="Delete" onclick="event.stopPropagation();deleteItem('${jsName}')"><i class="fa-solid fa-trash"></i></button>`;
    return `<div class="actions-row">${btns}</div>${buildMoreMenuWrapper(item)}`;
}

function buildMoreMenuWrapper(item) {
    const jsName = escapeJs(item.name);
    let items = '';
    if (!item.is_dir && isImageFile(item.name))
        items += `<button onclick="closeAllMoreMenus();previewImage('${jsName}')"><i class="fa-solid fa-eye"></i> Preview</button>`;
    if (!item.is_dir && item.name.toLowerCase().endsWith('.pdf'))
        items += `<button onclick="closeAllMoreMenus();previewPdf('${jsName}')"><i class="fa-solid fa-eye"></i> Preview</button>`;
    if (!item.is_dir && item.name.toLowerCase().endsWith('.txt'))
        items += `<button onclick="closeAllMoreMenus();openEditor('${jsName}')"><i class="fa-solid fa-pencil"></i> Edit</button>`;
    items += `<button onclick="closeAllMoreMenus();openRenamePopup('${jsName}')"><i class="fa-solid fa-i-cursor"></i> Rename</button>`;
    items += `<button onclick="closeAllMoreMenus();shareItem('${jsName}',${item.is_dir})"><i class="fa-solid fa-share-nodes"></i> Share</button>`;
    if (item.is_dir) {
        const dirPath = escapeJs(`${currentDir}/${item.name}`);
        items += `<button onclick="closeAllMoreMenus();downloadDirectoryAsZip('${dirPath}')"><i class="fa-solid fa-download"></i> Download</button>`;
    } else {
        items += `<button onclick="closeAllMoreMenus();downloadItem('${jsName}')"><i class="fa-solid fa-download"></i> Download</button>`;
    }
    items += `<button class="danger" onclick="closeAllMoreMenus();deleteItem('${jsName}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    return `<div class="more-menu-wrapper"><button class="more-menu-btn" onclick="event.stopPropagation();toggleMoreMenu(this)"><i class="fa-solid fa-ellipsis-vertical"></i></button><div class="more-menu">${items}</div></div>`;
}

function toggleMoreMenu(btn) {
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    closeAllMoreMenus();
    if (!wasOpen) menu.classList.add('open');
}

function closeAllMoreMenus() {
    document.querySelectorAll('.more-menu.open').forEach(m => m.classList.remove('open'));
}

document.addEventListener('click', () => closeAllMoreMenus());

function parseSizeToBytes(sizeString) {
    if (!sizeString || sizeString === "--") return 0; // Treat missing sizes as 0 bytes

    const units = ["B", "KB", "MB", "GB", "TB"];
    const [value, unit] = sizeString.split(" ");
    const multiplier = Math.pow(1024, units.indexOf(unit));
    return parseFloat(value) * multiplier;
}

function sortItemsData(items, column, direction) {
    return [...items].sort((a, b) => {
        let av, bv;
        if (column === 'size') {
            av = parseSizeToBytes(a.size || '--');
            bv = parseSizeToBytes(b.size || '--');
        } else if (column === 'last_modified') {
            av = a.last_modified || 0;
            bv = b.last_modified || 0;
        } else {
            av = a.name.toLowerCase();
            bv = b.name.toLowerCase();
        }
        return direction === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
}

function sortTable(column) {
    if (sortState.column === column) {
        if (sortState.direction === 'asc') sortState.direction = 'desc';
        else if (sortState.direction === 'desc') sortState.direction = 'unsorted';
        else sortState.direction = 'asc';
    } else {
        sortState = { column, direction: 'asc' };
    }
    saveSortPreference();

    if (sortState.direction === 'unsorted') {
        if (isSearchActive) renderSearchResults(currentSearchResults);
        else fetchFiles();
        updateSortArrows(column);
        updateGridSortUI(column);
        return;
    }

    const source = isSearchActive ? currentSearchResults : currentItems;
    const sorted = sortItemsData(source, column, sortState.direction);
    if (isSearchActive) currentSearchResults = sorted;
    currentItems = sorted;

    if (isSearchActive) {
        // update table rows only (grid already rendered via renderSearchResults)
        const fileTable = document.getElementById('fileTable');
        const rows = Array.from(fileTable.rows);
        rows.sort((a, b) => {
            let av, bv;
            if (column === 'size') {
                av = parseSizeToBytes(a.querySelector('.size')?.textContent.trim());
                bv = parseSizeToBytes(b.querySelector('.size')?.textContent.trim());
            } else if (column === 'last_modified') {
                av = parseInt(a.getAttribute('data-last-modified'), 10);
                bv = parseInt(b.getAttribute('data-last-modified'), 10);
            } else {
                av = a.querySelector('.name').textContent.trim().toLowerCase();
                bv = b.querySelector('.name').textContent.trim().toLowerCase();
            }
            return sortState.direction === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
        fileTable.innerHTML = '';
        rows.forEach(row => fileTable.appendChild(row));
    } else {
        const fileTableBody = document.getElementById('fileTable');
        const rows = Array.from(fileTableBody.rows);
        rows.sort((a, b) => {
            let av, bv;
            if (column === 'size') {
                av = parseSizeToBytes(a.querySelector('.size')?.textContent.trim());
                bv = parseSizeToBytes(b.querySelector('.size')?.textContent.trim());
            } else if (column === 'last_modified') {
                av = parseInt(a.getAttribute('data-last-modified'), 10);
                bv = parseInt(b.getAttribute('data-last-modified'), 10);
            } else {
                av = a.querySelector('.name').textContent.trim().toLowerCase();
                bv = b.querySelector('.name').textContent.trim().toLowerCase();
            }
            return sortState.direction === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
        fileTableBody.innerHTML = '';
        rows.forEach(row => fileTableBody.appendChild(row));
    }

    // Always re-render grid with sorted data
    renderGridView(sorted);
    updateSortArrows(column);
    updateGridSortUI(column);
}

function updateGridSortUI(activeColumn) {
    document.querySelectorAll('#gridSortBar button[data-col]').forEach(btn => {
        const col = btn.dataset.col;
        const icon = btn.querySelector('i');
        if (col === activeColumn && sortState.direction !== 'unsorted') {
            btn.classList.add('active');
            icon.className = sortState.direction === 'asc'
                ? 'fa-solid fa-arrow-up'
                : 'fa-solid fa-arrow-down';
        } else {
            btn.classList.remove('active');
            icon.className = 'fa-solid fa-arrow-up-wide-short';
        }
    });
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
        renderEmptyState();
        updateSelectAllCheckbox();
        return;
    }

    const sortedResults = applyCurrentSort(results);
    fileTable.innerHTML = sortedResults.map(item => {
        const icon = getFileTypeIcon(item.name, item.is_dir);
        const nameCell = item.is_dir
            ? `${icon}<a href="#" onclick="event.stopPropagation();navigate('${escapeJs(item.name)}')" class="directory">${item.name}</a>`
            : `${icon}<span class="filename">${item.name}</span>`;
        return `
        <tr data-last-modified="${item.last_modified || ''}" onclick="rowClick(this)">
            <td onclick="event.stopPropagation()"><input type="checkbox" value="${escapeAttr(item.name)}" onclick="updateSelectAllCheckbox()"></td>
            <td class="name">${nameCell}</td>
            <td class="size">${item.size || '--'}</td>
            <td class="last_modified">${item.last_modified ? formatDate(item.last_modified) : '--'}</td>
            <td class="actions-cell">${buildActionsHtml(item)}</td>
        </tr>`;
    }).join('');

    updateSelectAllCheckbox();
    currentItems = sortedResults;
    renderGridView(sortedResults);
    updateSortArrows(sortState.column);
    updateGridSortUI(sortState.column);
}

async function initialize() {
    initTheme();
    initView();
    document.getElementById('footer-year').textContent = new Date().getFullYear();
    try {
        const response = await fetch("/config");
        const data = await response.json();
        currentDir = data.base_dir;
        baseDir = data.base_dir;
        fetchFiles();
    } catch (error) {
        console.error("Error initializing:", error);
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

function updateBreadcrumbs() {
    const bar = document.getElementById("breadcrumbBar");
    if (!bar || !baseDir) return;
    const relative = currentDir.startsWith(baseDir)
        ? currentDir.slice(baseDir.length).replace(/^[/\\]+/, "")
        : "";
    const parts = relative ? relative.split(/[\\/]+/).filter(Boolean) : [];
    const crumbs = [`<button onclick="navigateToRoot()">Root</button>`];
    let builtPath = baseDir;
    parts.forEach((part, index) => {
        builtPath += `/${part}`;
        const escapedPath = escapeJs(builtPath);
        const safePart = escapeAttr(part);
        crumbs.push(`<span class="breadcrumb-separator"><i class="fa-solid fa-chevron-right"></i></span><button onclick="navigateToPath('${escapedPath}')" ${index === parts.length - 1 ? 'aria-current="page"' : ""}>${safePart}</button>`);
    });
    bar.innerHTML = crumbs.join("");
}

async function navigateToPath(path) {
    currentDir = path;
    isSearchActive = false;
    await fetchFiles();
}

document.getElementById("overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
        closeUploadPopup();
        closeCreateDirPopup();
        closeConfirmPopup();
        closeAlertPopup();
        closeEditorPopup();
        closeImagePreview();
        closePdfPreview();
        closeRenamePopup();
        closeSharePopup();
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

function isImageFile(name) {
    return /\.(png|jpg|jpeg|gif)$/i.test(name);
}

function previewImage(fileName) {
    const img = document.getElementById("previewImg");
    const popup = document.getElementById("imagePreviewPopup");
    const overlay = document.getElementById("overlay");

    const imageUrl = `/serve_image?target_dir=${encodeURIComponent(currentDir)}&file_name=${encodeURIComponent(fileName)}`;
    img.src = imageUrl;
    currentImagePreviewName = fileName;

    popup.style.display = "block";
    overlay.style.display = "block";
}

function getVisibleImages() {
    return getVisibleItems()
        .filter(item => !item.is_dir && isImageFile(item.name))
        .map(item => item.name);
}

function showAdjacentImage(direction) {
    const images = getVisibleImages();
    if (images.length === 0 || !currentImagePreviewName) return;
    const index = images.indexOf(currentImagePreviewName);
    const nextIndex = (index + direction + images.length) % images.length;
    previewImage(images[nextIndex]);
}

function closeImagePreview() {
    const popup = document.getElementById("imagePreviewPopup");
    const overlay = document.getElementById("overlay");
    const img = document.getElementById("previewImg");

    popup.style.display = "none";
    overlay.style.display = "none";
    img.src = "";
    currentImagePreviewName = null;
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
            showToast("File saved.", "success");
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

function updateSelectionButtons() {
    const anyChecked = document.querySelectorAll("tbody#fileTable input[type='checkbox']:checked").length > 0;
    const display = anyChecked ? '' : 'none';
    document.getElementById('downloadSelectedBtn').style.display = display;
    document.getElementById('deleteSelectedBtn').style.display = display;
}

function toggleSelectAll(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll("tbody#fileTable input[type='checkbox']");
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
        const row = checkbox.closest('tr');
        if (row) row.classList.toggle('selected', selectAllCheckbox.checked);
    });
    // Sync grid view
    document.querySelectorAll('.card-checkbox').forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        const card = cb.closest('.grid-card');
        if (card) card.classList.toggle('selected', selectAllCheckbox.checked);
    });
    updateSelectionButtons();
}

// Ensure that when individual checkboxes are toggled, the "Select All" checkbox is updated
function updateSelectAllCheckbox() {
    const checkboxes = document.querySelectorAll("tbody#fileTable input[type='checkbox']");
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");

    const allChecked = Array.from(checkboxes).every(checkbox => checkbox.checked);
    const noneChecked = Array.from(checkboxes).every(checkbox => !checkbox.checked);

    // Update the "Select All" checkbox state
    if (checkboxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (allChecked) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (noneChecked) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true; // Show indeterminate state
    }
    updateSelectionButtons();
}

function rowClick(tr) {
    const checkbox = tr.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        tr.classList.toggle('selected', checkbox.checked);
        updateSelectAllCheckbox();
    }
}

function applyCurrentSort(items) {
    if (!sortState.column || sortState.direction === "unsorted") return items;
    return sortItemsData(items, sortState.column, sortState.direction);
}

function renderEmptyState() {
    const fileTable = document.getElementById("fileTable");
    fileTable.innerHTML = `
        <tr>
            <td colspan="5">
                <div class="empty-state">
                    <div>No files or directories found.</div>
                    <div class="empty-state-actions">
                        <button class="button" onclick="openUploadPopup()"><i class="fa-solid fa-upload"></i> Upload</button>
                        <button class="button secondary" onclick="openCreateDirPopup()"><i class="fa-solid fa-folder-plus"></i> New Folder</button>
                    </div>
                </div>
            </td>
        </tr>`;
    document.getElementById("gridContainer").innerHTML = `
        <div class="empty-state">
            <div>No files or directories found.</div>
            <div class="empty-state-actions">
                <button class="button" onclick="openUploadPopup()"><i class="fa-solid fa-upload"></i> Upload</button>
                <button class="button secondary" onclick="openCreateDirPopup()"><i class="fa-solid fa-folder-plus"></i> New Folder</button>
            </div>
        </div>`;
}

function renderFiles(items) {
    currentItems = applyCurrentSort(items);
    updateBreadcrumbs();
    const fileTable = document.getElementById("fileTable");
    if (currentItems.length === 0) {
        renderEmptyState();
        updateSelectAllCheckbox();
        return;
    }
    fileTable.innerHTML = currentItems.map(item => {
        const icon = getFileTypeIcon(item.name, item.is_dir);
        const nameCell = item.is_dir
            ? `${icon}<a href="#" onclick="event.stopPropagation();navigate('${escapeJs(item.name)}')" class="directory">${item.name}</a>`
            : `${icon}<span class="filename">${item.name}</span>`;
        return `
        <tr data-last-modified="${item.last_modified}" onclick="rowClick(this)">
            <td onclick="event.stopPropagation()"><input type="checkbox" value="${escapeAttr(item.name)}" onclick="updateSelectAllCheckbox()"></td>
            <td class="name">${nameCell}</td>
            <td class="size">${item.size || '--'}</td>
            <td class="last_modified">${formatDate(item.last_modified)}</td>
            <td class="actions-cell">${buildActionsHtml(item)}</td>
        </tr>`;
    }).join('');

    updateSelectAllCheckbox();
    renderGridView(currentItems);
    updateSortArrows(sortState.column);
    updateGridSortUI(sortState.column);
}

function renderGridView(items) {
    const grid = document.getElementById('gridContainer');
    if (!grid) return;
    grid.innerHTML = items.map((item, idx) => {
        const isImg = !item.is_dir && isImageFile(item.name);
        const iconHtml = getGridCardIcon(item.name, item.is_dir);
        let mediaHtml;
        if (isImg) {
            const imgSrc = `/serve_image?target_dir=${encodeURIComponent(currentDir)}&file_name=${encodeURIComponent(item.name)}`;
            mediaHtml = `<div class="card-media"><img class="card-thumb" src="${imgSrc}" alt="${escapeAttr(item.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><i class="fa-solid fa-file-image card-icon image" style="display:none;"></i></div>`;
        } else {
            mediaHtml = `<div class="card-media">${iconHtml || '<i class="fa-solid fa-file card-icon default"></i>'}</div>`;
        }
        const jsName = escapeJs(item.name);

        // Build action buttons (same logic as buildActionsHtml but for cards)
        let cardBtns = '';
        if (!item.is_dir && isImageFile(item.name))
            cardBtns += `<button class="btn-action" title="Preview" onclick="event.stopPropagation();previewImage('${jsName}')"><i class="fa-solid fa-eye"></i></button>`;
        if (!item.is_dir && item.name.toLowerCase().endsWith('.pdf'))
            cardBtns += `<button class="btn-action" title="Preview" onclick="event.stopPropagation();previewPdf('${jsName}')"><i class="fa-solid fa-eye"></i></button>`;
        if (!item.is_dir && item.name.toLowerCase().endsWith('.txt'))
            cardBtns += `<button class="btn-action" title="Edit" onclick="event.stopPropagation();openEditor('${jsName}')"><i class="fa-solid fa-pencil"></i></button>`;
        cardBtns += `<button class="btn-action" title="Rename" onclick="event.stopPropagation();openRenamePopup('${jsName}')"><i class="fa-solid fa-i-cursor"></i></button>`;
        cardBtns += `<button class="btn-action" title="Share" onclick="event.stopPropagation();shareItem('${jsName}',${item.is_dir})"><i class="fa-solid fa-share-nodes"></i></button>`;
        if (item.is_dir) {
            cardBtns += `<button class="btn-action" title="Download" onclick="event.stopPropagation();downloadDirectoryAsZip('${escapeJs(currentDir + '/' + item.name)}')"><i class="fa-solid fa-download"></i></button>`;
        } else {
            cardBtns += `<button class="btn-action" title="Download" onclick="event.stopPropagation();downloadItem('${jsName}')"><i class="fa-solid fa-download"></i></button>`;
        }
        cardBtns += `<button class="btn-action danger" title="Delete" onclick="event.stopPropagation();deleteItem('${jsName}')"><i class="fa-solid fa-trash"></i></button>`;

        return `
        <div class="grid-card" id="grid-card-${idx}" onclick="gridCardClick(${idx},'${jsName}',${item.is_dir})">
            <input type="checkbox" class="card-checkbox" value="${escapeAttr(item.name)}" onclick="event.stopPropagation();gridCheckboxClick(${idx},'${jsName}',this.checked)">
            ${mediaHtml}
            <div class="card-name">${item.name}</div>
            <div class="card-size">${item.size || '--'}</div>
            <div class="card-actions">${cardBtns}</div>
        </div>`;
    }).join('');
}

function gridCardClick(idx, name, isDir) {
    if (isDir) { navigate(name); return; }
    gridCheckboxClick(idx, name);
}

function gridCheckboxClick(idx, name, checked = null) {
    const card = document.getElementById(`grid-card-${idx}`);
    const cb = card.querySelector('.card-checkbox');
    cb.checked = checked === null ? !cb.checked : checked;
    card.classList.toggle('selected', cb.checked);
    // Sync table checkbox
    const tableCb = document.querySelector(`tbody#fileTable input[value="${CSS.escape(name)}"]`);
    if (tableCb) {
        tableCb.checked = cb.checked;
        const row = tableCb.closest('tr');
        if (row) row.classList.toggle('selected', cb.checked);
    }
    updateSelectAllCheckbox();
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

function openUploadPopup(options = {}) {
    const { preserveQueue = false } = options;
    document.getElementById("uploadPopup").style.display = "block";
    document.getElementById("overlay").style.display = "block";
    document.getElementById("targetDir").value = currentDir;

    if (!preserveQueue) {
        document.getElementById("uploadFile").value = ""; // Reset file input
        queuedFiles = []; // Clear the queue
        updateFileListPreview(); // Clear preview list
    }
}

function closeUploadPopup() {
    document.getElementById("uploadPopup").style.display = "none";
    document.getElementById("overlay").style.display = "none";
    document.getElementById("uploadForm").reset();
    queuedFiles = []; // Clear queue on close
    uploadStatus.clear();
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
        showToast("Folder created.", "success");
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

    openConfirmPopup(
        `Are you sure you want to delete ${itemsToDelete.length} selected item(s)?`,
        async () => {
            try {
                // Send the delete request (force = false)
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

                // Check response for "DIRECTORIES_NOT_EMPTY"
                if (!response.ok && data.error === "DIRECTORIES_NOT_EMPTY") {
                    const nonEmptyDirs = data.dirs;
                    openConfirmPopup(
                        `The following directories are not empty: ${nonEmptyDirs.join(", ")}. Delete them anyway?`,
                        async () => {
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
                                openAlertPopup("Error forcing deletion: " + secondData.error);
                            } else {
                                showToast("Selected items deleted.", "success");
                            }
                            fetchFiles();
                        },
                        () => {
                            openAlertPopup("Deletion was canceled.");
                            fetchFiles();
                        }
                    );
                }
                else if (!response.ok) {
                    openAlertPopup("Error during deletion: " + data.error);
                    fetchFiles();
                }
                else {
                    showToast("Selected items deleted.", "success");
                    fetchFiles();
                }

            } catch (err) {
                openAlertPopup("Error during deletion: " + err.message);
            }
        }
    );
}

async function downloadSelected() {
    const selectedCheckboxes = Array.from(document.querySelectorAll("tbody#fileTable input[type='checkbox']:checked"));
    if (selectedCheckboxes.length === 0) {
        openAlertPopup("No items selected for download.");
        return;
    }

    const itemsToDownload = selectedCheckboxes.map(cb => cb.value);
    openAlertPopup("Preparing your download, please wait...");

    try {
        const response = await fetch("/download_selected_zip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_dir: currentDir, items: itemsToDownload })
        });

        if (!response.ok) {
            const err = await response.json();
            openAlertPopup("Error creating ZIP: " + (err.error || "Unknown error"));
            return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "selected_files.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        closeAlertPopup();
    } catch (error) {
        openAlertPopup("Error initiating download: " + error.message);
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
    queueUploadFiles(Array.from(event.target.files));
});

function queueUploadFiles(files, options = {}) {
    const { openPopup = false } = options;
    const newFiles = files.filter(file => file && file.size > 0);

    newFiles.forEach(file => {
        const alreadyQueued = queuedFiles.some(queuedFile =>
            queuedFile.name === file.name &&
            queuedFile.size === file.size &&
            queuedFile.lastModified === file.lastModified
        );

        if (!alreadyQueued) {
            queuedFiles.push(file);
            uploadStatus.set(file.name, "queued");
        }
    });

    if (openPopup && newFiles.length > 0) {
        openUploadPopup({ preserveQueue: true });
    } else {
        document.getElementById("targetDir").value = currentDir;
    }

    updateFileListPreview();
    return newFiles.length;
}

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

async function resolveUploadConflicts(files) {
    const existingNames = getExistingNames();
    const resolvedFiles = [];
    for (const file of files) {
        if (!existingNames.has(file.name)) {
            existingNames.add(file.name);
            resolvedFiles.push(file);
            continue;
        }

        const choice = await openUploadConflictPopup(file.name);
        if (choice === "replace") {
            resolvedFiles.push(file);
        } else if (choice === "keep") {
            const uniqueName = getUniqueFileName(file.name, existingNames);
            const renamedFile = copyFileWithName(file, uniqueName);
            existingNames.add(uniqueName);
            uploadStatus.set(uniqueName, uploadStatus.get(file.name) || "queued");
            resolvedFiles.push(renamedFile);
        } else {
            uploadStatus.set(file.name, "skipped");
        }
    }
    return resolvedFiles;
}

function openUploadConflictPopup(fileName) {
    const popup = document.getElementById("uploadConflictPopup");
    const message = document.getElementById("uploadConflictMessage");
    const replaceBtn = document.getElementById("uploadConflictReplaceBtn");
    const keepBtn = document.getElementById("uploadConflictKeepBtn");
    const skipBtn = document.getElementById("uploadConflictSkipBtn");

    message.textContent = `"${fileName}" already exists in this folder. Choose how Muttley should handle it.`;
    popup.style.display = "block";
    document.getElementById("overlay").style.display = "block";

    return new Promise(resolve => {
        const cleanup = choice => {
            popup.style.display = "none";
            replaceBtn.onclick = null;
            keepBtn.onclick = null;
            skipBtn.onclick = null;
            if (document.getElementById("uploadPopup").style.display !== "block") {
                document.getElementById("overlay").style.display = "none";
            }
            resolve(choice);
        };
        replaceBtn.onclick = () => cleanup("replace");
        keepBtn.onclick = () => cleanup("keep");
        skipBtn.onclick = () => cleanup("skip");
    });
}


document.getElementById("uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const targetDir = document.getElementById("targetDir").value;

    // Check if there are queued files
    if (queuedFiles.length === 0) {
        openAlertPopup("No files selected for upload.");
        return;
    }

    showProgressBar();

    try {
        const filesToUpload = await resolveUploadConflicts(queuedFiles);
        if (filesToUpload.length === 0) {
            showToast("Upload canceled.", "info");
            return;
        }
        queuedFiles = filesToUpload;
        updateFileListPreview();

        // Upload each file in chunks
        for (const file of filesToUpload) {
            uploadStatus.set(file.name, "uploading");
            updateFileListPreview();
            await uploadFileInChunks(file, targetDir); // Use the new function
            uploadStatus.set(file.name, "done");
            updateFileListPreview();
        }

        showToast("All files uploaded successfully.", "success");
    } catch (error) {
        showToast("Error during file upload: " + error.message, "error");
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

    queueUploadFiles(Array.from(event.dataTransfer.files));
}

function getFilesFromDataTransfer(dataTransfer, options = {}) {
    const { imagesOnly = false } = options;
    const files = Array.from(dataTransfer?.files || []);
    if (!imagesOnly) return files;
    return files.filter(file => file.type.startsWith("image/"));
}

function getClipboardImageFiles(event) {
    const items = Array.from(event.clipboardData?.items || []);
    return items
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => renameClipboardImageFile(item.getAsFile(), item.type))
        .filter(Boolean);
}

function renameClipboardImageFile(file, mimeType) {
    if (!file) return null;

    const extensionByType = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/svg+xml": "svg"
    };
    const ext = extensionByType[mimeType] || file.name.split(".").pop() || "png";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `pasted-image-${timestamp}.${ext}`;

    return new File([file], name, {
        type: file.type || mimeType,
        lastModified: Date.now()
    });
}

function isEditablePasteTarget(target) {
    return Boolean(target?.closest?.("input, textarea, [contenteditable='true']"));
}

function handlePagePaste(event) {
    const imageFiles = getClipboardImageFiles(event);
    if (imageFiles.length === 0) return;

    event.preventDefault();
    if (!isEditablePasteTarget(event.target)) {
        event.stopPropagation();
    }

    queueUploadFiles(imageFiles, { openPopup: true });
}

function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function setPageDragActive(active) {
    document.body.classList.toggle("page-drag-upload-active", active);
}

function handlePageDragEnter(event) {
    if (!hasDraggedFiles(event)) return;
    pageDragDepth += 1;
    setPageDragActive(true);
}

function handlePageDragOver(event) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
}

function handlePageDragLeave(event) {
    if (!hasDraggedFiles(event)) return;
    pageDragDepth = Math.max(0, pageDragDepth - 1);
    if (pageDragDepth === 0) {
        setPageDragActive(false);
    }
}

function handlePageDrop(event) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();
    event.stopPropagation();
    pageDragDepth = 0;
    setPageDragActive(false);

    const files = getFilesFromDataTransfer(event.dataTransfer);
    queueUploadFiles(files, { openPopup: true });
}

function updateFileListPreview() {
    const fileListPreview = document.getElementById("fileListPreview");
    if (queuedFiles.length === 0) {
        fileListPreview.innerHTML = '';
        return;
    }
    fileListPreview.innerHTML = queuedFiles.map((file, idx) => `
        <li>
            <i class="fa-solid fa-file" style="color:var(--text-muted);flex-shrink:0;"></i>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</span>
            <span style="color:var(--text-muted);font-size:.72rem;flex-shrink:0;">${(file.size / 1024).toFixed(1)} KB</span>
            <span class="upload-status ${(uploadStatus.get(file.name) || 'queued')}">${uploadStatus.get(file.name) || 'queued'}</span>
            <button type="button" class="remove-file-btn" onclick="removeQueuedFile(${idx})" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </li>`).join('');
}

function removeQueuedFile(idx) {
    uploadStatus.delete(queuedFiles[idx]?.name);
    queuedFiles.splice(idx, 1);
    updateFileListPreview();
}

document.getElementById("dropZone").addEventListener("dragover", handleDragOver);
document.getElementById("dropZone").addEventListener("dragleave", () => {
    document.getElementById("dropZone").classList.remove("dragover");
});
document.getElementById("dropZone").addEventListener("drop", handleDrop);
document.getElementById("dropZone").addEventListener("click", () => {
    document.getElementById("uploadFile").click();
});

document.addEventListener("paste", handlePagePaste);
document.addEventListener("dragenter", handlePageDragEnter);
document.addEventListener("dragover", handlePageDragOver);
document.addEventListener("dragleave", handlePageDragLeave);
document.addEventListener("drop", handlePageDrop);
document.addEventListener("keydown", handleKeyboardShortcuts);

function isTypingTarget(target) {
    return Boolean(target?.closest?.("input, textarea, [contenteditable='true']"));
}

function closeTopPopupOrClearSelection() {
    const openPopups = ["uploadPopup", "createDirPopup", "confirmPopup", "alertPopup", "renamePopup", "sharePopup", "imagePreviewPopup", "pdfPreviewPopup"];
    const open = openPopups.find(id => document.getElementById(id)?.style.display === "block");
    if (open) {
        ({
            uploadPopup: closeUploadPopup,
            createDirPopup: closeCreateDirPopup,
            confirmPopup: closeConfirmPopup,
            alertPopup: closeAlertPopup,
            renamePopup: closeRenamePopup,
            sharePopup: closeSharePopup,
            imagePreviewPopup: closeImagePreview,
            pdfPreviewPopup: closePdfPreview
        })[open]();
        return;
    }
    if (document.getElementById("editorPopup").classList.contains("is-open")) {
        closeEditorPopup();
        return;
    }
    document.querySelectorAll("tbody#fileTable input[type='checkbox'], .card-checkbox").forEach(cb => {
        cb.checked = false;
        cb.closest("tr, .grid-card")?.classList.remove("selected");
    });
    updateSelectAllCheckbox();
}

function handleKeyboardShortcuts(event) {
    if (isTypingTarget(event.target)) return;
    if (document.getElementById("imagePreviewPopup").style.display === "block" && event.key === "ArrowLeft") {
        event.preventDefault();
        showAdjacentImage(-1);
        return;
    }
    if (document.getElementById("imagePreviewPopup").style.display === "block" && event.key === "ArrowRight") {
        event.preventDefault();
        showAdjacentImage(1);
        return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "a") {
        event.preventDefault();
        const selectAll = document.getElementById("selectAllCheckbox");
        selectAll.checked = true;
        toggleSelectAll(selectAll);
    } else if (event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
    } else if (event.key === "Escape") {
        closeTopPopupOrClearSelection();
    } else if (event.key === "/") {
        event.preventDefault();
        document.getElementById("searchInput").focus();
    } else if (key === "r") {
        refreshFiles();
    }
}

async function deleteItem(fileName) {
    openConfirmPopup(
        `Are you sure you want to delete "${fileName}"?`,
        async () => {
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
                    const nonEmptyDir = data.dirs[0] || fileName;
                    openConfirmPopup(
                        `The directory "${nonEmptyDir}" is not empty. Do you want to delete it anyway?`,
                        async () => {
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
                                openAlertPopup("Error forcing deletion: " + forceData.error);
                            } else {
                                showToast(`"${fileName}" deleted.`, "success");
                            }
                            fetchFiles();
                        },
                        () => {
                            openAlertPopup("Deletion was canceled.");
                            fetchFiles();
                        }
                    );
                }
                else if (!response.ok) {
                    openAlertPopup("Error deleting: " + data.error);
                    fetchFiles();
                }
                else {
                    showToast(`"${fileName}" deleted.`, "success");
                    fetchFiles();
                }

            } catch (error) {
                openAlertPopup("Unexpected error: " + error.message);
            }
        }
    );
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


/* ============================================================
   RENAME
   ============================================================ */

function openRenamePopup(name) {
    startInlineRename(name);
}

function getNameNodeForInlineRename(name) {
    const tableCb = document.querySelector(`tbody#fileTable input[value="${CSS.escape(name)}"]`);
    const row = tableCb?.closest("tr");
    const rowNameNode = row?.querySelector(".filename, .directory");
    if (rowNameNode) return rowNameNode;
    const cardCb = document.querySelector(`.card-checkbox[value="${CSS.escape(name)}"]`);
    return cardCb?.closest(".grid-card")?.querySelector(".card-name") || null;
}

function startInlineRename(name) {
    const node = getNameNodeForInlineRename(name);
    if (!node) {
        renameTarget = name;
        document.getElementById('renameInput').value = name;
        document.getElementById('renamePopup').style.display = 'block';
        document.getElementById('overlay').style.display = 'block';
        setTimeout(() => selectNameWithoutExtension(document.getElementById('renameInput')), 50);
        return;
    }

    const input = document.createElement("input");
    input.className = "inline-rename-input";
    input.value = name;
    node.replaceWith(input);
    input.focus();
    selectNameWithoutExtension(input);

    let submitted = false;
    const submit = async () => {
        if (submitted) return;
        submitted = true;
        const newName = input.value.trim();
        if (!newName || newName === name) {
            fetchFiles();
            return;
        }
        await renameItem(name, newName);
    };

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") submit();
        if (event.key === "Escape") {
            submitted = true;
            fetchFiles();
        }
    });
    input.addEventListener("blur", submit);
}

async function renameItem(oldName, newName) {
    try {
        const resp = await fetch('/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_dir: currentDir, old_name: oldName, new_name: newName })
        });
        const data = await resp.json();
        if (!resp.ok) openAlertPopup('Error renaming: ' + data.error);
        else showToast("Renamed.", "success");
        fetchFiles();
    } catch (err) {
        openAlertPopup('Error: ' + err.message);
        fetchFiles();
    }
}

function closeRenamePopup() {
    document.getElementById('renamePopup').style.display = 'none';
    document.getElementById('overlay').style.display = 'none';
    renameTarget = null;
}

document.getElementById('renameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName || newName === renameTarget) { closeRenamePopup(); return; }
    try {
        await renameItem(renameTarget, newName);
        closeRenamePopup();
    } catch (err) {
        openAlertPopup('Error: ' + err.message);
    }
});

/* ============================================================
   SHARE
   ============================================================ */
async function shareItem(fileName, isDirectory = false) {
    try {
        const resp = await fetch('/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_dir: currentDir, file_name: fileName, is_directory: isDirectory })
        });
        const data = await resp.json();
        if (!resp.ok) { openAlertPopup('Error creating share link: ' + data.error); return; }
        const url = `${window.location.origin}/share/${data.token}`;
        document.getElementById('shareUrlInput').value = url;
        const expiry = new Date(data.expiresAt);
        document.getElementById('shareExpiryNote').textContent =
            `This link expires on ${expiry.toLocaleDateString()} at ${expiry.toLocaleTimeString()} (7 days).`;
        document.getElementById('sharePopup').style.display = 'block';
        document.getElementById('overlay').style.display = 'block';
    } catch (err) {
        openAlertPopup('Error: ' + err.message);
    }
}

function closeSharePopup() {
    document.getElementById('sharePopup').style.display = 'none';
    document.getElementById('overlay').style.display = 'none';
}

async function copyShareLink() {
    const input = document.getElementById('shareUrlInput');
    try {
        await navigator.clipboard.writeText(input.value);
        showToast('Link copied to clipboard.', 'success');
    } catch {
        input.select();
        document.execCommand('copy');
        showToast('Link copied.', 'success');
    }
}

// Initialize on page load
initialize();

