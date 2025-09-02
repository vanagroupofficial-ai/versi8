/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GenerateVideosParameters, GoogleGenAI} from '@google/genai';

const GEMINI_API_KEY = process.env.API_KEY;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>(async (resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Clean up the object URL after download
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Renders a video blob onto a canvas with a watermark and encodes it into a new blob.
 * @param videoBlob The original video blob.
 * @returns A promise that resolves with the new watermarked video blob.
 */
async function addWatermark(videoBlob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const videoUrl = URL.createObjectURL(videoBlob);
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.src = videoUrl;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return reject(new Error('Could not get canvas context'));
    }

    const chunks: Blob[] = [];
    let recorder: MediaRecorder;

    videoEl.addEventListener('loadeddata', () => {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;

      const stream = canvas.captureStream();
      recorder = new MediaRecorder(stream, {mimeType: 'video/mp4'});

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const watermarkedBlob = new Blob(chunks, {type: 'video/mp4'});
        URL.revokeObjectURL(videoUrl);
        resolve(watermarkedBlob);
      };

      recorder.onerror = (e) =>
        reject((e as any).error || new Error('Recorder error'));

      let frameRequestHandle: number;

      const drawFrame = () => {
        if (videoEl.paused || videoEl.ended) {
          if (frameRequestHandle) cancelAnimationFrame(frameRequestHandle);
          return;
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

        const fontSize = 14;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 2;
        const padding = canvas.width * 0.02;
        ctx.fillText('VANAPRO AI', canvas.width - padding, canvas.height - padding);

        frameRequestHandle = requestAnimationFrame(drawFrame);
      };

      videoEl.play();
      recorder.start();
      drawFrame();
    });

    videoEl.addEventListener('ended', () => {
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
    });

    videoEl.addEventListener('error', (e) => reject(new Error('Video failed to load')));
  });
}


async function generateContent(
  prompt: string,
  imageBytes: string,
  duration: number,
  aspectRatio: string,
) {
  const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});

  const config: GenerateVideosParameters = {
    model: 'veo-2.0-generate-001',
    prompt,
    config: {
      durationSeconds: duration,
      aspectRatio: aspectRatio,
      numberOfVideos: 1,
    },
  };

  if (imageBytes) {
    config.image = {
      imageBytes,
      mimeType: 'image/png',
    };
  }

  let operation = await ai.models.generateVideos(config);

  while (!operation.done) {
    console.log('Waiting for completion');
    await delay(1000);
    operation = await ai.operations.getVideosOperation({operation});
  }

  const videos = operation.response?.generatedVideos;
  if (videos === undefined || videos.length === 0) {
    throw new Error('No videos generated');
  }

  const firstVideo = videos[0];
  const url = decodeURIComponent(firstVideo.video.uri);
  const res = await fetch(`${url}&key=${GEMINI_API_KEY}`);
  const blob = await res.blob();
  
  statusEl.innerText = 'Applying watermark... This may take a moment.';
  try {
    const watermarkedBlob = await addWatermark(blob);
    const objectURL = URL.createObjectURL(watermarkedBlob);
    video.src = objectURL;
    videoContainer.style.display = 'block';

    downloadFile(objectURL, 'generated_video_watermarked.mp4');
    statusEl.innerText = 'Video generated and download started.';
    console.log('Watermarked video is ready for playback and download.');
  } catch (e) {
    console.error('Failed to add watermark:', e);
    statusEl.innerText = `Error applying watermark: ${e.message}. Downloading original.`;
    const objectURL = URL.createObjectURL(blob);
    video.src = objectURL;
    videoContainer.style.display = 'block';
    downloadFile(objectURL, 'generated_video_original.mp4');
    alert("Could not apply watermark. Downloading original video instead.");
  }
}

const upload = document.querySelector('#file-input') as HTMLInputElement;
const imagePreview = document.querySelector('#img') as HTMLImageElement;
const imagePreviewContainer = document.querySelector('#image-preview-container') as HTMLDivElement;
const removeImageButton = document.querySelector('#remove-image-button') as HTMLButtonElement;
let base64data = '';
let prompt = '';

upload.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files[0];
  if (file) {
    imagePreview.src = URL.createObjectURL(file);
    imagePreviewContainer.style.display = 'block';
    base64data = await blobToBase64(file);
  }
});

removeImageButton.addEventListener('click', () => {
    upload.value = ''; // Clear the file input
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
    base64data = '';
});

const promptEl = document.querySelector(
  '#prompt-input',
) as HTMLTextAreaElement;
promptEl.addEventListener('change', async () => {
  prompt = promptEl.value;
});

const durationSlider = document.querySelector(
  '#duration-slider',
) as HTMLInputElement;
const durationValue = document.querySelector(
  '#duration-value',
) as HTMLSpanElement;
let duration = 5;

durationSlider.addEventListener('input', () => {
  duration = parseInt(durationSlider.value, 10);
  durationValue.textContent = durationSlider.value;
});

const aspectRatioSelect = document.querySelector(
  '#aspect-ratio-select',
) as HTMLSelectElement;
let aspectRatio = '16:9';

aspectRatioSelect.addEventListener('change', () => {
  aspectRatio = aspectRatioSelect.value;
});

const statusEl = document.querySelector('#status') as HTMLParagraphElement;
const videoContainer = document.querySelector(
  '#video-container',
) as HTMLDivElement;
const video = document.querySelector('#video') as HTMLVideoElement;
const quotaErrorEl = document.querySelector('#quota-error') as HTMLDivElement;
const loadingOverlay = document.querySelector(
  '#loading-overlay',
) as HTMLDivElement;

const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;

let isFirstGenerateClick = true;

generateButton.addEventListener('click', (e) => {
  if (isFirstGenerateClick) {
    window.open('https://s.shopee.co.id/AUkDYOEDW1', '_blank');
    isFirstGenerateClick = false;
  } else {
    generate();
  }
});

async function generate() {
  if (!prompt.trim()) {
    alert('Please enter a prompt to generate a video.');
    return;
  }
  statusEl.innerText = '';
  loadingOverlay.style.display = 'flex';
  videoContainer.style.display = 'none';
  quotaErrorEl.style.display = 'none';

  generateButton.disabled = true;
  upload.disabled = true;
  promptEl.disabled = true;
  durationSlider.disabled = true;
  aspectRatioSelect.disabled = true;

  try {
    await generateContent(prompt, base64data, duration, aspectRatio);
  } catch (e) {
    try {
      const err = JSON.parse(e.message);
      if (err.error.code === 429) {
        // Out of quota.
        quotaErrorEl.style.display = 'block';
        statusEl.innerText = '';
      } else {
        statusEl.innerText = err.error.message;
      }
    } catch (err) {
      statusEl.innerText = e.message;
      console.log('error', e.message);
    }
  } finally {
    loadingOverlay.style.display = 'none';
    generateButton.disabled = false;
    upload.disabled = false;
    promptEl.disabled = false;
    durationSlider.disabled = false;
    aspectRatioSelect.disabled = false;
  }
}