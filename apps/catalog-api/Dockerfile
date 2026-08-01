# input: Python source and uv lockfile
# output: Non-root Storyflow catalog API container
# pos: Reproducible deployment boundary for the private-network adapter

FROM python:3.13-slim-bookworm

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock ./
# uv.lock pins the sole runtime dependency; direct wheel install keeps the production image bootstrappable.
RUN pip install --no-cache-dir --index-url https://pypi.org/simple pymysql==1.2.0
COPY src ./src

USER nobody
EXPOSE 8788
CMD ["python", "src/catalog_api.py"]
