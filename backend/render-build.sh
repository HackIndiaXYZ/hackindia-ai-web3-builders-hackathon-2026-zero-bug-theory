#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Compiling smart contracts to generate ABIs..."
cd ../contracts
npm install
npx hardhat compile
cd ../backend

echo "Installing gdown to download from Google Drive..."
pip install gdown

echo "Downloading ONNX bundle from Google Drive..."
# WARNING: REPLACE THIS ID WITH THE NEW ID FROM YOUR ONNX ZIP
FILE_ID="1_NUuKAxReJghiI73YUrbcebOBtEyuC7e"
gdown "$FILE_ID" -O anemiascan_bundle.zip

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Running V4 bundle installer..."
python scripts/install_v4_bundle.py anemiascan_bundle.zip

echo "Cleaning up bundle zip..."
rm anemiascan_bundle.zip

echo "Build complete!"
