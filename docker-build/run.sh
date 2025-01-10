# Exit on any error
set -e

cd /server/

# Activate virtual environment
if [ -f "venv/bin/activate" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
else
    python3 -m venv venv
    source venv/bin/activate
fi

# Check if required Python dependencies are installed
if ! pip freeze | grep -q flask; then
    echo "Installing Python dependencies..."
    pip install -r requirements.txt
fi

# Start the Flask app
echo "Starting Flask development server..."
python3 ./Muttley/file_server.py --root /data/
