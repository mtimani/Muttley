# Muttley - File Manager

<div style="display: flex; align-items: center; gap: 20px;">
    <img src="./images/logo.jpg" alt="Muttley Logo" width="75"/>
    <div>
        <p><strong>Welcome to the Muttley repo!</strong></p>
        <p>
            Muttley is a sleek and user-friendly file manager designed for local and server-side file management.
            Built with Python and Flask on the backend and an intuitive HTML, CSS, and JavaScript frontend,
            Muttley provides a robust solution for navigating, uploading, downloading, and managing files seamlessly.
        </p>
    </div>
</div>



## 🔔 Features
- **Dynamic File Navigation**: Effortlessly navigate through directories with a clean and responsive UI.
- **Upload and Download**: Drag-and-drop file uploads with progress feedback and easy file downloads, including support for downloading directories as ZIP archives.
- **Edit On-the-Fly**: Edit text files directly within the app using the built-in editor.
- **Batch Operations**: Delete multiple files and folders simultaneously, with confirmation prompts for non-empty directories.
- **Streamlined Design**: A visually appealing layout with an integrated header featuring a clickable logo and title for easy navigation back to the root directory.

## 📦 Technologies Used
- **Easy deployment**: Docker and docker-compose.yml
- **Backend**: Python (Flask) for managing file operations and routing.
- **Frontend**: HTML, CSS, and JavaScript for a responsive and interactive user experience.
- **File Management Features**: Robust handling of file sizes, folder structures, and metadata.

## 🔎 Usage
### Using Docker (Recommended for production)
```bash
mkdir data
wget -c https://raw.githubusercontent.com/mtimani/Muttley/refs/heads/main/docker-compose.yml
docker compose up -d
```

### Standalone (Recommended for developpment and testing)
#### Installation
```bash
git clone https://gitlab.timanimario.com/various/new_updog
cd new_updog/docker-build/
pip3 install -r requirements.txt
```

#### Usage
```bash
cd new_updog/docker-build/Muttley
mkdir data
python3 file_server.py --root ./data
```

## 📖 Why Muttley?
Whether you’re a developer managing server files or a user looking for a simple local file explorer, Muttley is designed to make file management straightforward, efficient, and enjoyable.
