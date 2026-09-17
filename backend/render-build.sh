#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Installing gdown to download from Google Drive..."
pip install gdown

echo "Downloading AnemiaScan V4 bundle from Google Drive..."
# The ID is extracted from the Google Drive link provided
FILE_ID="1Nr3Ga50QDU28QCs87qPiGSPx90r6LcEt"
gdown "$FILE_ID" -O anemiascan_bundle.zip

echo "Installing CPU version of PyTorch..."
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Running V4 bundle installer..."
python scripts/install_v4_bundle.py anemiascan_bundle.zip

echo "Cleaning up bundle zip..."
rm anemiascan_bundle.zip

echo "Build complete!"
