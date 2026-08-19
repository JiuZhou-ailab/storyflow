# Storyflow Edge Gateway

单一 Nginx 入口将 `/hot-drama/` 等稳定路径转发到 `storyflow-edge` Docker 网络中的独立服务；鉴权由各上游服务负责。Files: `compose.yaml`, `nginx.conf`.
