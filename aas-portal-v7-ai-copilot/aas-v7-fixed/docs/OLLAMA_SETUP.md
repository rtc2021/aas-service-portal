# AAS AI Copilot - Ollama Server Setup

This guide explains how to set up the Ollama server that powers the AI Copilot.

## Quick Start (Local Testing)

### 1. Install Ollama

**macOS:**
```bash
brew install ollama
```

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:**
Download from https://ollama.com/download/windows

### 2. Start the Server

```bash
ollama serve
```

The server runs at `http://localhost:11434`

### 3. Pull a Model

For the best balance of quality and speed, use Llama 3.1 8B:

```bash
ollama pull llama3.1:8b
```

Other options:
- `mistral` - Fast, good for simpler queries
- `llama3.1:70b` - Better quality but requires more RAM/VRAM
- `deepseek-coder:6.7b` - Good for technical content

### 4. Test It

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "What is a learn cycle on an automatic door?"}]
  }'
```

---

## Production Setup (Office Server)

For production, you'll want the Ollama server accessible from your Netlify-hosted portal.

### Option A: Cloudflare Tunnel (Recommended)

This exposes your local Ollama server securely without opening firewall ports.

1. **Install cloudflared:**
   ```bash
   # macOS
   brew install cloudflared
   
   # Linux
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```

2. **Authenticate:**
   ```bash
   cloudflared tunnel login
   ```

3. **Create tunnel:**
   ```bash
   cloudflared tunnel create aas-ai
   ```

4. **Configure tunnel** (create `~/.cloudflared/config.yml`):
   ```yaml
   tunnel: aas-ai
   credentials-file: /path/to/.cloudflared/<tunnel-id>.json
   
   ingress:
     - hostname: ai.aas-portal.com
       service: http://localhost:11434
     - service: http_status:404
   ```

5. **Run tunnel:**
   ```bash
   cloudflared tunnel run aas-ai
   ```

6. **Update Netlify environment variable:**
   ```
   OLLAMA_BASE_URL=https://ai.aas-portal.com
   ```

### Option B: ngrok (Quick Setup)

1. **Install ngrok:** https://ngrok.com/download

2. **Expose Ollama:**
   ```bash
   ngrok http 11434
   ```

3. **Copy the URL** (e.g., `https://abc123.ngrok.io`)

4. **Set in Netlify:**
   - Site settings → Environment variables
   - Add: `OLLAMA_BASE_URL=https://abc123.ngrok.io`

**Note:** ngrok URLs change each restart unless you have a paid plan.

### Option C: VPS/Cloud Server

Deploy Ollama on a cloud VM (DigitalOcean, Linode, AWS, etc.):

1. **Provision a server** with at least:
   - 16GB RAM (32GB for 70B models)
   - 4+ CPU cores
   - GPU optional but recommended

2. **Install Ollama:**
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```

3. **Configure to listen on all interfaces:**
   ```bash
   # Edit /etc/systemd/system/ollama.service
   # Add to [Service] section:
   Environment="OLLAMA_HOST=0.0.0.0"
   
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

4. **Set up HTTPS** (use nginx + Let's Encrypt):
   ```nginx
   server {
       listen 443 ssl;
       server_name ai.aas-portal.com;
       
       ssl_certificate /etc/letsencrypt/live/ai.aas-portal.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/ai.aas-portal.com/privkey.pem;
       
       location / {
           proxy_pass http://localhost:11434;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

5. **Add API key protection** (optional):
   ```nginx
   location / {
       if ($http_x_api_key != "your-secret-key") {
           return 403;
       }
       proxy_pass http://localhost:11434;
   }
   ```

---

## Environment Variables

Set these in Netlify (Site settings → Environment variables):

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_BASE_URL` | URL of your Ollama server | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model to use | `llama3.1:8b` |

---

## Hardware Recommendations

| Model | Min RAM | Recommended | GPU |
|-------|---------|-------------|-----|
| `llama3.1:8b` | 8GB | 16GB | Optional |
| `mistral` | 8GB | 16GB | Optional |
| `llama3.1:70b` | 48GB | 64GB | Required |

**With GPU acceleration:**
- NVIDIA GPU with 8GB+ VRAM for 8B models
- NVIDIA GPU with 48GB+ VRAM for 70B models

---

## Troubleshooting

### "AI Server Unavailable" error

1. Check if Ollama is running: `curl http://localhost:11434`
2. Check if the tunnel/ngrok is running
3. Verify `OLLAMA_BASE_URL` in Netlify env vars
4. Check Netlify function logs for connection errors

### Slow responses

1. Consider a smaller model (`mistral` instead of `llama3.1:70b`)
2. Add GPU acceleration
3. Increase server resources

### "Model not found" error

Pull the model first:
```bash
ollama pull llama3.1:8b
```

List available models:
```bash
ollama list
```

---

## Enhancing with RAG (Future)

To give the AI access to your full tech manuals:

1. **Convert PDFs to text** (already done for playbooks)
2. **Create embeddings** using Ollama's embedding endpoint
3. **Store in vector database** (ChromaDB, Pinecone, etc.)
4. **Query similar chunks** before sending to LLM

This is a more advanced setup - let me know when you're ready to implement it.

---

## Security Notes

- The Copilot API requires Auth0 authentication (Admin/Tech role)
- Don't expose Ollama directly to the internet without auth
- Use HTTPS for production deployments
- Consider rate limiting for cost control

---

## Quick Checklist

- [ ] Install Ollama
- [ ] Pull model (`ollama pull llama3.1:8b`)
- [ ] Start server (`ollama serve`)
- [ ] Test locally (`curl http://localhost:11434/v1/models`)
- [ ] Set up tunnel (Cloudflare/ngrok) for production
- [ ] Add `OLLAMA_BASE_URL` to Netlify environment variables
- [ ] Deploy portal with copilot-ai.mts
- [ ] Test from the portal
