# Muttley - File Manager
Muttley is a sleek and user-friendly file manager designed for local and server-side file management.
Built with Node.js on the backend and an intuitive HTML, CSS, and JavaScript frontend,
Muttley provides a robust solution for navigating, uploading, downloading, and managing files seamlessly.

![logo](./images/interface.png)

## 🔔 Features
- **Dynamic File Navigation**: Effortlessly navigate through directories with a clean and responsive UI.
- **Upload and Download**: File uploads with progress feedback, per-file upload status, and easy file downloads, including support for downloading directories as ZIP archives.
- **Paste Image Uploads**: Paste an image from your clipboard with `Ctrl+V` / `Cmd+V` on the main screen to open the upload popup with the image already queued.
- **Drag-and-Drop Anywhere**: Drop files directly on the main screen to open the upload popup with the dropped files queued automatically. The upload popup still supports its own drag-and-drop area and click-to-browse selection.
- **Upload Conflict Choices**: When an uploaded file already exists, choose whether to replace it, keep both files, or skip it.
- **Bulk Download**: Select multiple files and folders and download them all at once as a single ZIP archive using the **Download Selected** button.
- **Edit On-the-Fly**: Edit text files directly within the app using the built-in editor.
- **PDF Preview**: Preview PDF files directly in an overlay popup without leaving the interface, using a built-in viewer with iframe rendering.
- **Image Preview**: Preview images (PNG, JPG, JPEG, GIF) directly in an overlay popup without leaving the interface, with previous/next navigation.
- **Batch Operations**: Delete multiple files and folders simultaneously, with confirmation prompts for non-empty directories.
- **Breadcrumb Navigation**: Jump between parent folders quickly with a clickable breadcrumb path.
- **Empty Folder Actions**: Empty folders show quick actions for uploading files or creating a new folder.
- **Keyboard Shortcuts**: Use shortcuts for common actions like select all, delete selected items, close popups, focus search, refresh, and browse image previews.
- **Manual Refresh**: Instantly re-sync the file list with the server using the **Refresh** button in the header — no page reload, state and open editors are preserved.
- **Inline Rename**: Rename files and folders directly from the file list or grid view. Filename text is selected without the extension by default.
- **Share Links**: Generate a secure, time-limited download link for any file or folder. Folder share links download the folder as a ZIP archive, matching the standard folder download behavior. Links are valid for **7 days**, require no login to use, and work automatically in any deployment (local, Docker, or production) thanks to `window.location.origin`-based URL generation. Share links are stored in memory and cleaned up automatically on expiry.
- **List & Grid Views**: Switch between a compact list view and a large icon grid view (with image thumbnails) using the toggle in the header.
- **Remembered Preferences**: Theme, view mode, and sort preference are saved in `localStorage`.
- **Toast Notifications**: Non-blocking status messages keep confirmations visible without interrupting the workflow.
- **Dark Mode**: Toggle between light and dark themes — preference is saved in `localStorage`.
- **Streamlined Design**: A visually appealing layout with an integrated header featuring a clickable logo and title for easy navigation back to the root directory.
- **Basic Authentication support**: Optional Basic Authentication ensures secure access by requiring a username and password. Easily configurable in the backend, it protects against unauthorized usage while maintaining flexibility for deployments without mandatory login.

## 📦 Technologies Used
- **Easy deployment**: Docker and docker-compose.yml
- **Backend**: Node.js for managing file operations and routing.
- **Frontend**: HTML, CSS, and JavaScript for a responsive and interactive user experience.
- **File Management Features**: Robust handling of file sizes, folder structures, and metadata.

## 🔎 Usage
### Automated deployment using certbot SSL certificates and nginx reverse proxy (Recommended for public network production environment)
```bash
wget -c https://raw.githubusercontent.com/mtimani/Muttley/refs/heads/main/ssl-automated-deployment/ssl-automated-deployment.sh
chmod +x ssl-automated-deployment.sh

# Install Muttley with Basic Auth
sudo ./ssl-automated-deployment.sh -d $DOMAIN_NAME -e $CERTBOT_EMAIL -b $BASIC_AUTH_USERNAME:$BASIC_AUTH_PASSWORD

# Install Muttley without Basic Auth
sudo ./ssl-automated-deployment.sh -d $DOMAIN_NAME -e $CERTBOT_EMAIL
```

`ssl-automated-deployment.sh` help:
```bash
Usage: ./ssl-automated-setup.sh -d <domain_name> -e <certbot_email> [-b <auth_username:auth_password>]

  -d <domain_name>       The domain name for SSL setup.
  -e <certbot_email>     The email for Certbot registration.
  -b <username:password> Optional. Enables BasicAuth with specified username and password.
  -h                     Display this help message.
```

### Using Docker (Recommended for local network production environment)
> :warning: **Please check the environment variables and the shared volume before launching the `docker compose up -d` command!** 
```bash
wget -c https://raw.githubusercontent.com/mtimani/Muttley/refs/heads/main/docker-compose.yml
docker compose up -d
```

### Standalone (Recommended for developpment and testing)
#### Installation
```bash
git clone https://github.com/mtimani/Muttley.git
```

#### Usage (without Basic Authentication)
```bash
cd /docker-build/Muttley-JS/backend
FILE_SERVER_ROOT="./data" npm start
```

#### Usage (with Basic Authentication)
```bash
cd /docker-build/Muttley-JS/backend
AUTH_USERNAME=admin AUTH_PASSWORD=supersecurepassword FILE_SERVER_ROOT="./data" npm start
```

## 📖 Why Muttley?
Whether you’re a developer managing server files or a user looking for a simple local file explorer, Muttley is designed to make file management straightforward, efficient, and enjoyable.
