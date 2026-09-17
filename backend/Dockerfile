FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ML_DEVICE=cpu

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1 \
    && pip install -r requirements.txt \
    && pip install gdown \
    && gdown 1_NUuKAxReJghiI73YUrbcebOBtEyuC7e -O anemiascan_bundle.zip

COPY . .

RUN python scripts/install_v4_bundle.py anemiascan_bundle.zip \
    && rm anemiascan_bundle.zip

CMD exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}