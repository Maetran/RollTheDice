build:
docker build -t wuerfler .
docker run -d --name wuerfler -p 8000:8000 -v "$(pwd)/data:/app/data" wuerfler
