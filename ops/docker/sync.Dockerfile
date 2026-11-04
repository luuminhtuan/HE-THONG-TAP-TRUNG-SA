# Ảnh Python cho sync + migration khi chạy bằng docker compose (04/11/2026, docs/POSTGRES.md).
# Chỉ cài thư viện — code KHÔNG chép vào ảnh: compose gắn cả repo vào /app, sửa code là chạy bản mới.
# requirements.txt đổi thì dựng lại: docker compose build sync
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Không ghi __pycache__ vào repo đang gắn; log ra ngay, không đợi đầy bộ đệm.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
