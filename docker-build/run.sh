# Exit on any error
set -e

echo "Starting NPM server..."
cd /server/Muttley-JS/backend
FILE_SERVER_ROOT="/data/" npm start
