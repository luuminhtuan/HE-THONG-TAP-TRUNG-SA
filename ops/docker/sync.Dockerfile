# Ảnh Python cho sync, báo cáo, migration và lịch việc nền khi chạy bằng docker compose
# (04/11/2026, docs/POSTGRES.md). Chỉ cài thư viện — code KHÔNG chép vào ảnh: compose gắn cả repo vào
# /app, sửa code là chạy bản mới. requirements.txt đổi thì dựng lại: docker compose build lich
FROM python:3.12-slim

# curl: hai việc nền gọi route của dashboard (snapshot_cron.sh, tracking-import.sh).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Không ghi __pycache__ vào repo đang gắn; log ra ngay, không đợi đầy bộ đệm.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
