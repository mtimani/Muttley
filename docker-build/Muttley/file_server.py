from flask import Flask, request, jsonify, send_from_directory, render_template, abort, send_file
import os
from werkzeug.utils import secure_filename
import argparse
import logging
import json
import shutil
import io
import zipfile

app = Flask(__name__)
BASE_DIR = None  # Will be set via script arguments
UPLOAD_METADATA_FILE = None  # To be configured dynamically

# Configure logging
logging.basicConfig(level=logging.INFO)

def safe_path(path):
    """Ensure paths stay within the BASE_DIR."""
    absolute_path = os.path.abspath(path)
    if not absolute_path.startswith(BASE_DIR):
        abort(403, description="Access outside the root directory is forbidden.")
    return absolute_path

@app.route("/")
def home():
    """Serve the frontend."""
    return render_template("index.html")

def format_size(size):
    """Convert size in bytes to human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0

@app.route("/list", methods=["POST"])
def list_items():
    """List items in the specified directory and handle navigation."""
    current_dir = request.json.get("current_dir", BASE_DIR)
    action = request.json.get("action", None)  # Action: navigate or go back

    try:
        if action == "go_back":
            # Navigate one level up but prevent going above BASE_DIR
            current_dir = os.path.dirname(current_dir)
            if not current_dir.startswith(BASE_DIR):
                current_dir = BASE_DIR
        
        if action == "go_root":
            current_dir = BASE_DIR

        safe_current_dir = safe_path(current_dir)

        items = [
            {
                "name": item,
                "is_dir": os.path.isdir(os.path.join(safe_current_dir, item)),
                "size": format_size(os.path.getsize(os.path.join(safe_current_dir, item))) if not os.path.isdir(os.path.join(safe_current_dir, item)) else None,
                "last_modified": os.path.getmtime(os.path.join(safe_current_dir, item)),
            }
            for item in os.listdir(safe_current_dir)
        ]

        # Sort items: directories first (alphabetical), files second (alphabetical)
        sorted_items = sorted(
            items,
            key=lambda x: (not x["is_dir"], x["name"].lower())
        )

        return jsonify({"current_dir": safe_current_dir, "items": sorted_items})
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 400


@app.route("/upload", methods=["POST"])
def upload_files():
    """
    Upload files to the specified directory or update the content of a text file.
    """
    try:
        # If the request is JSON (for live editing)
        if request.content_type == "application/json":
            data = request.get_json()
            file_name = data.get("file_name")
            content = data.get("content")
            target_dir = data.get("target_dir", "")  # Get target_dir from the JSON payload

            # Validate file name and content
            if not file_name or content is None:
                return jsonify({"error": "File name or content is missing"}), 400

            # Resolve the safe file path
            safe_target_dir = safe_path(os.path.join(BASE_DIR, target_dir))
            file_path = safe_path(os.path.join(safe_target_dir, file_name))
            logging.info(file_path)

            # Write the updated content to the file
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)

            return jsonify({"message": "File updated successfully"})

        # If the request is for file uploads
        files = request.files.getlist("file")
        target_dir = request.form.get("target_dir", BASE_DIR)

        safe_target_dir = safe_path(target_dir)

        if not files:
            return jsonify({"error": "No files uploaded"}), 400

        # Save each uploaded file
        for file in files:
            filename = secure_filename(file.filename)
            file.save(os.path.join(safe_target_dir, filename))

        return jsonify({"message": "Files uploaded successfully"})

    except Exception as e:
        logging.error(f"Error handling upload or edit: {e}")
        return jsonify({"error": str(e)}), 400


@app.route("/delete", methods=["POST"])
def delete_items():
    import shutil  # si pas déjà importé
    
    target_dir = request.json.get("target_dir", BASE_DIR)
    items = request.json.get("items", [])
    force = request.json.get("force", False)
    
    try:
        safe_target_dir = safe_path(target_dir)
        
        # On stocke ici les dossiers non vides
        non_empty_dirs = []
        
        # 1) Vérifier tous les items
        for item in items:
            path = os.path.join(safe_target_dir, secure_filename(item))
            if not os.path.exists(path):
                return jsonify({"error": f"Item {item} not found"}), 404
            
            if os.path.isdir(path):
                # Vérifier si vide
                if len(os.listdir(path)) > 0:
                    non_empty_dirs.append(item)
            # on ne supprime rien dans ce premier passage
        
        # 2) Si on a trouvé des dossiers non vides et force == False : on renvoie l'erreur
        if non_empty_dirs and not force:
            return jsonify({
                "error": "DIRECTORIES_NOT_EMPTY",
                "dirs": non_empty_dirs
            }), 400
        
        # 3) Si on arrive ici : soit pas de dossier non vide, soit force == True
        for item in items:
            path = os.path.join(safe_target_dir, secure_filename(item))
            
            if os.path.isdir(path):
                # Dossier
                if force:
                    # suppression récursive
                    shutil.rmtree(path)
                else:
                    # sinon dossier vide (car on a déjà vérifié plus haut)
                    os.rmdir(path)
            else:
                # Fichier
                os.remove(path)
        
        return jsonify({"message": "Selected items deleted successfully"})

    except Exception as e:
        logging.error(f"Error deleting items: {e}")
        return jsonify({"error": str(e)}), 400


@app.route("/download", methods=["POST"])
def download_file_post():
    """Stream a specific file."""
    try:
        data = request.get_json()
        target_dir = data.get("target_dir")
        file_name = data.get("file_name")

        if not target_dir or not file_name:
            return jsonify({"error": "target_dir or file_name is missing"}), 400

        # Resolve the safe file path
        safe_target_dir = safe_path(os.path.join(BASE_DIR, target_dir))
        file_path = safe_path(os.path.join(safe_target_dir, file_name))

        # Ensure the file exists
        if not os.path.isfile(file_path):
            return jsonify({"error": "File not found"}), 404

        # Stream the file
        return send_file(
            file_path,
            as_attachment=True,
            download_name=file_name,
            conditional=True
        )
    except Exception as e:
        logging.error(f"Error downloading file: {e}")
        return jsonify({"error": str(e)}), 400  

@app.route("/download_zip", methods=["POST"])
def download_directory_as_zip():
    """
    Create and download a ZIP file of the specified directory.
    """
    try:
        data = request.get_json()
        target_dir = data.get("target_dir")

        if not target_dir:
            return jsonify({"error": "target_dir is missing"}), 400

        # Resolve the full directory path
        safe_target_dir = safe_path(os.path.join(BASE_DIR, target_dir))

        # Ensure the target is a directory
        if not os.path.isdir(safe_target_dir):
            return jsonify({"error": "Specified target is not a directory"}), 400

        # Create a ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for root, dirs, files in os.walk(safe_target_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, safe_target_dir)  # Relative path inside the ZIP
                    zip_file.write(file_path, arcname)

        # Return the ZIP file as a response
        zip_buffer.seek(0)
        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"{os.path.basename(safe_target_dir)}.zip"
        )
    except Exception as e:
        logging.error(f"Error creating ZIP for directory: {e}")
        return jsonify({"error": str(e)}), 400


@app.route("/create_dir", methods=["POST"])
def create_directory():
    """Create a new directory."""
    target_dir = request.json.get("target_dir", BASE_DIR)
    dir_name = request.json.get("dirname", "").strip()

    if not dir_name:
        return jsonify({"error": "Directory name cannot be empty"}), 400
    if "/" in dir_name or "\\" in dir_name:
        return jsonify({"error": "Invalid directory name"}), 400

    try:
        safe_target_dir = safe_path(target_dir)
        dir_path = os.path.join(safe_target_dir, secure_filename(dir_name))

        # Ensure the directory does not already exist
        if os.path.exists(dir_path):
            return jsonify({"error": "Directory already exists"}), 400

        os.makedirs(dir_path, exist_ok=True)
        return jsonify({"message": "Directory created successfully"})
    except Exception as e:
        logging.error(f"Error creating directory: {e}")
        return jsonify({"error": str(e)}), 400

@app.route("/config", methods=["GET"])
def get_config():
    """Expose configuration settings to the frontend."""
    return jsonify({"base_dir": BASE_DIR})



if __name__ == "__main__":
    # Parse command-line arguments
    parser = argparse.ArgumentParser(description="File Manager Backend")
    parser.add_argument("--root", required=True, help="Specify the root directory for the server")
    parser.add_argument("--metadata", required=False, help="Path to store upload metadata", default="./upload_metadata.json")
    args = parser.parse_args()

    # Set BASE_DIR and ensure it exists
    BASE_DIR = os.path.abspath(args.root)
    if not os.path.exists(BASE_DIR):
        os.makedirs(BASE_DIR)

    # Set metadata file path
    UPLOAD_METADATA_FILE = os.path.abspath(args.metadata)

    print(f"Server running with root directory: {BASE_DIR}")
    print(f"Metadata file stored at: {UPLOAD_METADATA_FILE}")
    app.run(host="0.0.0.0", port=5000, debug=True)
