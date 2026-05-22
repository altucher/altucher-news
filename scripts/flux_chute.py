#!/usr/bin/env python3
"""
BlueTAO FLUX Image Generation Chute

Deploy this to Chutes to get your own FLUX image generation endpoint.

Prerequisites:
1. Install the Chutes SDK: pip install chutes
2. Set up authentication: chutes login (use your Bittensor wallet or API key)
3. Build: chutes build flux_chute:chute --wait
4. Deploy: chutes deploy flux_chute:chute

After deployment, your endpoint will be:
https://your-username-flux-schnell.chutes.ai/generate
"""

from chutes.chute import NodeSelector
from chutes.chute.template.diffusion import build_diffusion_chute

# Build FLUX-Schnell chute for fast image generation
chute = build_diffusion_chute(
    username="altucher",  # Replace with your Chutes username
    model_name="black-forest-labs/FLUX.1-schnell",
    revision="main",
    node_selector=NodeSelector(
        gpu_count=1,
        min_vram_gb_per_gpu=24,  # FLUX needs ~24GB VRAM
        include=["a100", "h100", "rtx4090"]  # Prefer high-end GPUs
    ),
    tagline="FLUX.1-schnell fast image generation for BlueTAO",
    readme="""
# BlueTAO FLUX Image Generation

Fast, high-quality image generation using FLUX.1-schnell model.

## Features
- Fast 4-step inference
- High quality 1024x1024 images
- OpenAI-compatible API

## API Endpoint
POST /generate

```json
{
    "prompt": "A beautiful sunset over the ocean",
    "width": 1024,
    "height": 1024,
    "num_inference_steps": 4,
    "guidance_scale": 0
}
```

## Response
Returns base64-encoded PNG image.
    """,
    
    # FLUX-schnell optimized settings
    scheduler="euler_a",
    guidance_scale=0,  # FLUX-schnell doesn't need CFG
    num_inference_steps=4,  # FLUX-schnell is fast with 4 steps
    height=1024,
    width=1024,
    safety_checker=False,  # FLUX has its own safety
    concurrency=2
)

if __name__ == "__main__":
    print("FLUX chute defined successfully!")
    print("\nNext steps:")
    print("1. Run: chutes build flux_chute:chute --wait")
    print("2. Run: chutes deploy flux_chute:chute")
    print("3. Your endpoint will be: https://altucher-flux-schnell.chutes.ai/generate")
