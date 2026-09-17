"""Convert the original PyTorch AnemiaScan bundle to a Quantized ONNX bundle.

Requires:
    pip install torch torchvision onnx onnxruntime
"""

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

import torch
from torch import nn
from torchvision.models import convnext_tiny, efficientnet_b3, vit_b_16
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

class BaseTransferClassifier(nn.Module):
    def __init__(self, name: str):
        super().__init__()
        self.name = name
        if name == "efficientnet_b3":
            self.net = efficientnet_b3(weights=None)
            dimension = self.net.classifier[-1].in_features
            self.net.classifier = nn.Sequential(
                nn.Dropout(0.35),
                nn.Linear(dimension, 256),
                nn.GELU(),
                nn.Dropout(0.2),
                nn.Linear(256, 1),
            )
        elif name == "convnext_tiny":
            self.net = convnext_tiny(weights=None)
            dimension = self.net.classifier[-1].in_features
            self.net.classifier[-1] = nn.Sequential(
                nn.Dropout(0.30), nn.Linear(dimension, 1)
            )
        else:
            raise ValueError(name)

    def encode(self, image: torch.Tensor) -> torch.Tensor:
        value = self.net.features(image)
        value = self.net.avgpool(value)
        if self.name == "convnext_tiny":
            value = self.net.classifier[0](value)
        return torch.flatten(value, 1)

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        embedding = self.encode(image)
        if self.name == "efficientnet_b3":
            return self.net.classifier(embedding).flatten()
        return self.net.classifier[-1](embedding).flatten()


class ViTB16Binary(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = vit_b_16(weights=None)
        self.net.heads.head = nn.Sequential(
            nn.LayerNorm(768), nn.Dropout(0.30), nn.Linear(768, 1)
        )

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.net(image).flatten()


def export_and_quantize(model: nn.Module, dummy_input: torch.Tensor, output_path: Path):
    model.eval()
    fp32_path = output_path.with_suffix(".fp32.onnx")
    
    torch.onnx.export(
        model,
        dummy_input,
        str(fp32_path),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}}
    )
    
    print(f"Quantizing {output_path.name}...")
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(output_path),
        weight_type=QuantType.QUInt8
    )
    fp32_path.unlink() # Cleanup full precision model


def convert_bundle(input_zip: Path, output_zip: Path):
    print(f"Extracting {input_zip.name}...")
    with TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        with zipfile.ZipFile(input_zip, 'r') as zf:
            zf.extractall(tmp_path)
            
        out_dir = tmp_path / "onnx_build"
        out_dir.mkdir()
        
        # 1. Convert EfficientNet
        print("Converting EfficientNet-B3...")
        eff = BaseTransferClassifier("efficientnet_b3")
        eff.load_state_dict(torch.load(tmp_path / "base_models" / "efficientnet_b3_best.pth", map_location="cpu", weights_only=False)["state_dict"], strict=True)
        export_and_quantize(eff, torch.randn(1, 3, 300, 300), out_dir / "efficientnet_b3.onnx")
        
        # 2. Convert ConvNeXt
        print("Converting ConvNeXt-Tiny...")
        conv = BaseTransferClassifier("convnext_tiny")
        conv.load_state_dict(torch.load(tmp_path / "base_models" / "convnext_tiny_best.pth", map_location="cpu", weights_only=False)["state_dict"], strict=True)
        export_and_quantize(conv, torch.randn(1, 3, 224, 224), out_dir / "convnext_tiny.onnx")
        
        # 3. Convert ViT
        print("Converting ViT-B/16...")
        vit = ViTB16Binary()
        vit.load_state_dict(torch.load(tmp_path / "vit_b16_best.pth", map_location="cpu", weights_only=False)["state_dict"], strict=True)
        export_and_quantize(vit, torch.randn(1, 3, 224, 224), out_dir / "vit_b16.onnx")
        
        # 4. Copy static files
        print("Copying static assets...")
        shutil.copy(tmp_path / "stacking_model.joblib", out_dir / "stacking_model.joblib")
        shutil.copy(tmp_path / "train_only_scalers.npz", out_dir / "train_only_scalers.npz")
        shutil.copy(tmp_path / "runtime_config.json", out_dir / "runtime_config.json")
        shutil.copy(tmp_path / "metrics.json", out_dir / "metrics.json")
        
        # 5. Generate new manifest
        print("Generating new manifest...")
        required_files = [
            "efficientnet_b3.onnx",
            "convnext_tiny.onnx",
            "vit_b16.onnx",
            "stacking_model.joblib",
            "train_only_scalers.npz",
            "runtime_config.json",
            "metrics.json"
        ]
        
        digest = hashlib.sha256()
        for filename in sorted(required_files):
            encoded_name = filename.encode("utf-8")
            digest.update(len(encoded_name).to_bytes(4, "big"))
            digest.update(encoded_name)
            with (out_dir / filename).open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
                    
        manifest = {
            "model_version": "anemiascan-v4-onnx-int8",
            "model_hash": digest.hexdigest(),
            "hash_algorithm": "sha256-required-path-and-content-v1"
        }
        (out_dir / "model_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        
        # 6. Zip the new bundle
        print(f"Creating {output_zip.name}...")
        with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for filepath in out_dir.iterdir():
                if filepath.is_file():
                    zf.write(filepath, arcname=filepath.name)
                    
    print(f"Done! New bundle saved to {output_zip.resolve()}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input_zip", type=Path, help="Path to original PyTorch bundle")
    parser.add_argument("output_zip", type=Path, help="Path for new ONNX bundle")
    args = parser.parse_args()
    convert_bundle(args.input_zip, args.output_zip)
