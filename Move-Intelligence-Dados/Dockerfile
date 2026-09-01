FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (build-essential, libpq-dev for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY Move-Intelligence-Dados/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY Move-Intelligence-Dados/ ./

ENV PYTHONUNBUFFERED=1

CMD ["python3", "main.py", "--help"]
