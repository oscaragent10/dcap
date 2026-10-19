/* DCAP — dictée sur l'appareil : Whisper (open source) via Transformers.js v3 (ONNX Runtime Web), WebGPU si dispo sinon WASM.
   Aucun serveur ni clé : le modèle est téléchargé depuis le Hugging Face Hub puis gardé dans le cache du navigateur. */
import { AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
env.allowLocalModels = false;
const Q = new URLSearchParams(self.location.search); // tests : ?model=whisper-small&wasm=1
const MODEL = 'onnx-community/' + (/^whisper-(base|small|tiny)$/.test(Q.get('model') || '') ? Q.get('model') : 'whisper-small');
// WebGPU : opt-in (?gpu=1). Les fichiers q8 (meilleur rapport qualité / poids mesuré) tournent en WASM ; une version WebGPU efficace
// demanderait d'autres fichiers (fp16/fp32, 400–600 Mo) : pas raisonnable sur iPhone pour l'instant.
// Prompt de vocabulaire (Whisper « initial prompt », <|startofprev|>) : aide l'orthographe des termes du coach.
const PROMPT = 'Séance de course à pied : FC, D+, allure, fractionné, footing, SL, trail, gel Honey Stinger, Garmin, PacePro, Stone Steps, Run the Rock.';
let ready = null;
function post(m) { self.postMessage(m); }
async function hasGpu() { try { return !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch (e) { return false; } }
function load(forceWasm) {
  if (ready) return ready;
  ready = (async () => {
    const gpu = !forceWasm && Q.get('gpu') === '1' && await hasGpu();
    try { return await build(gpu ? 'webgpu' : 'wasm'); } catch (e) { if (!gpu) throw e; return await build('wasm'); } // WebGPU en échec → WASM
  })();
  ready.catch((e) => { ready = null; post({ type: 'load-error', error: String(e && e.message || e) }); });
  return ready;
}
async function build(device) {
  {
    const gpu = device === 'webgpu';
    const q = Q.get('dtype'), dtype = q ? { encoder_model: q, decoder_model_merged: q } : gpu ? { encoder_model: 'q4', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' };
    const files = {};
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) { files[p.file] = [p.loaded, p.total]; let l = 0, t = 0; for (const k in files) { l += files[k][0]; t += files[k][1]; } post({ type: 'progress', loaded: l, total: t }); }
    };
    const [tok, proc, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL, { progress_callback }),
      AutoProcessor.from_pretrained(MODEL, { progress_callback }),
      WhisperForConditionalGeneration.from_pretrained(MODEL, { dtype, device, progress_callback })
    ]);
    const id = (t) => tok.model.tokens_to_ids.get(t);
    const promptIds = tok.encode(' ' + PROMPT, { add_special_tokens: false });
    const init = [id('<|startofprev|>'), ...promptIds, id('<|startoftranscript|>'), id('<|fr|>'), id('<|transcribe|>'), id('<|notimestamps|>')];
    if (init.some((x) => x === undefined)) throw new Error('jetons spéciaux introuvables');
    // préchauffage (compile les shaders WebGPU / initialise WASM) sur 1 s de silence
    await model.generate({ ...(await proc(new Float32Array(16000))), max_new_tokens: 1, language: 'french', task: 'transcribe' });
    post({ type: 'ready', device });
    return { tok, proc, model, init, device };
  }
}
async function transcribe(audio) {
  const M = await load(), t0 = performance.now(), out = [];
  for (let i = 0; i < audio.length; i += 16000 * 30) { // fenêtres de 30 s (taille d'entrée de Whisper)
    const chunk = audio.subarray(i, Math.min(audio.length, i + 16000 * 30));
    if (chunk.length < 16000 * 0.3) break;
    const inputs = await M.proc(chunk);
    let ids;
    try { ids = await M.model.generate({ ...inputs, decoder_input_ids: M.init, max_new_tokens: 200 }); }
    catch (e) { ids = await M.model.generate({ ...inputs, language: 'french', task: 'transcribe', max_new_tokens: 200 }); } // sans prompt
    const seq = Array.from(ids.tolist ? ids.tolist()[0] : ids[0]).map(Number);
    const start = seq.length > M.init.length && seq.slice(0, M.init.length).every((x, k) => x === M.init[k]) ? M.init.length : 0;
    out.push(M.tok.decode(seq.slice(start), { skip_special_tokens: true }).trim());
  }
  return { text: out.join(' ').replace(/\s+/g, ' ').trim(), ms: Math.round(performance.now() - t0), device: M.device };
}
self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'load') await load(m.wasm);
    else if (m.type === 'transcribe') { const r = await transcribe(m.audio); post({ type: 'result', id: m.id, ...r }); }
  } catch (err) { post({ type: 'error', id: m.id, error: String(err && err.message || err) }); }
};
