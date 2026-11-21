import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const STORAGE_KEY = "titan-chat-history-v2";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const apiUrl = (path) => `${API_BASE}${path}`;

function readSavedMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function App() {
  const [messages, setMessages] = useState(readSavedMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("CHECKING CORE");
  const [configured, setConfigured] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const speechRef = useRef(null);
  const recognitionRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("PWA service worker registration failed:", error)));
    }
    const handleInstallPrompt = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", () => setInstallPrompt(null));
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  useEffect(() => {
    if (import.meta.env.PROD && !API_BASE) {
      setStatus("API NOT CONNECTED");
      return;
    }
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        setStatus(data.configured ? "CORE ONLINE" : "SETUP REQUIRED");
      })
      .catch(() => setStatus("SERVER OFFLINE"));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    window.speechSynthesis?.cancel?.();
  }, []);

  function stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    speechRef.current = null;
    setSpeakingIndex(null);
  }

  function speakMessage(text, index) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setVoiceMessage("Spoken responses are not supported in this browser. Try an updated Safari or Chrome browser.");
      return;
    }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeakingIndex(index);
    utterance.onend = () => { speechRef.current = null; setSpeakingIndex(null); };
    utterance.onerror = () => { speechRef.current = null; setSpeakingIndex(null); setVoiceMessage("TITAN could not play that response. Check your device's sound settings."); };
    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function stopVoiceCapture() {
    recognitionRef.current?.stop?.();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function startVoiceInput() {
    if (busy || voiceState === "listening" || voiceState === "transcribing") return;
    setVoiceMessage("");

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = navigator.language || "en-US";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onstart = () => { setVoiceState("listening"); setVoiceMessage("Listening… tap the microphone again to finish."); };
        recognition.onresult = (event) => {
          let transcript = "";
          for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
          setInput(transcript.trim());
        };
        recognition.onerror = (event) => {
          setVoiceMessage(event.error === "not-allowed" ? "Microphone permission was blocked. Allow microphone access in your browser settings." : `Voice input issue: ${event.error}.`);
          setVoiceState("idle");
        };
        recognition.onend = () => setVoiceState("idle");
        recognitionRef.current = recognition;
        recognition.start();
        return;
      } catch (error) {
        setVoiceMessage("Browser speech recognition unavailable. Trying secure audio transcription…");
      }
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceMessage("Voice input is not supported in this browser. Try an updated Safari or Chrome browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/mp4" });
        if (!blob.size) { setVoiceState("idle"); setVoiceMessage("No audio was captured. Try again."); return; }
        setVoiceState("transcribing");
        setVoiceMessage("Converting your speech to text…");
        try {
          if (import.meta.env.PROD && !API_BASE) throw new Error("TITAN's API server has not been connected yet.");
          const response = await fetch(apiUrl("/api/transcribe"), {
            method: "POST",
            headers: { "Content-Type": blob.type || "application/octet-stream" },
            body: blob
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Transcription failed.");
          setInput((current) => [current.trim(), data.text?.trim()].filter(Boolean).join(" "));
          setVoiceMessage(data.text ? "Speech added to your message. Review it, then tap Send." : "No speech was detected. Try again.");
        } catch (error) {
          setVoiceMessage(error.message || "Audio transcription failed.");
        } finally {
          setVoiceState("idle");
        }
      };
      recorder.start();
      setVoiceState("listening");
      setVoiceMessage("Recording… tap the microphone again to finish.");
    } catch (error) {
      setVoiceState("idle");
      setVoiceMessage(error.name === "NotAllowedError" ? "Microphone permission was denied. Allow access in your browser settings." : "Could not start the microphone. Check browser permissions and try again.");
    }
  }

  async function toggleVoiceInput() {
    if (voiceState === "listening") { stopVoiceCapture(); return; }
    await startVoiceInput();
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);

    try {
      if (import.meta.env.PROD && !API_BASE) throw new Error("TITAN is published, but its AI server has not been connected yet.");
      const response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-40), useWebSearch })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      const assistantReply = typeof data.reply === "string" ? data.reply : "TITAN returned an empty response.";
      const assistantMessage = {
        role: "assistant",
        content: assistantReply,
        searched: Boolean(data.searched),
        sources: Array.isArray(data.sources) ? data.sources.filter((source) =>
          source && typeof source.url === "string" && /^https?:\/\//i.test(source.url)
        ) : []
      };
      setMessages([...next, assistantMessage]);
      if (autoSpeak) speakMessage(assistantReply, next.length);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `Connection error: ${error.message}` }
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function newChat() {
    if (busy) return;
    stopSpeaking();
    setMessages([]);
    setInput("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div><div className="brand-name">TITAN</div><div className="brand-sub">INTELLIGENCE SYSTEM</div></div>
        </div>
        <button className="new-chat" onClick={newChat}>＋ <span>New conversation</span></button>
        <div className="side-label">YOUR WORKSPACE</div>
        <div className="side-item active">◈ <span>AI Assistant</span></div>
        <div className="side-item muted">▧ <span>Vision</span><small>Planned</small></div>
        <div className="side-item active">⌁ <span>Voice Input</span><small>STEP 3</small></div>
        <div className="side-item active">◎ <span>Web Intelligence</span><small>STEP 5</small></div>
        <div className="side-item muted">⌘ <span>Studio</span><small>Planned</small></div>
        <button className="settings-link" onClick={() => setShowSettings((v) => !v)}>⚙ <span>System settings</span></button>
        {showSettings && <div className="settings-panel">
          <strong>HONESTY PROFILE</strong>
          <p>Direct answers · Calibrated uncertainty · Respectful disagreement</p>
          <strong>MODEL</strong><p>Server-selected OpenAI model</p>
          <strong>PRIVACY</strong><p>Chat history is stored in this browser only. It is sent to the configured AI provider when you chat.</p>
        </div>}
        <div className="sidebar-bottom">
          <div className={`status-dot ${configured ? "online" : ""}`} />
          <div><strong>{status}</strong><small>{configured ? "API connection ready" : "API key required"}</small></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark small">T</span> TITAN</div>
          <div className="topbar-actions">
            {installPrompt && <button className="install-button" onClick={installApp}>＋ INSTALL APP</button>}
            <div className="topbar-right"><span className="secure-dot" /> PRIVATE SESSION</div>
          </div>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="orb"><span>T</span></div>
              <div className="eyebrow">YOUR AI. YOUR PERSPECTIVE.</div>
              <h1>Think bigger.<br /><em>Ask TITAN.</em></h1>
              <p>An AI that values clear thinking, honest answers, and useful ideas over simply telling you what you want to hear.</p>
              <div className="suggestions">
                {["What makes an AI genuinely useful?", "Help me build something ambitious", "Challenge an idea I have"].map((item) => (
                  <button key={item} onClick={() => setInput(item)}>{item}<span>↗</span></button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => (
                <article className={`message ${message.role}`} key={index}>
                  <div className="avatar">{message.role === "assistant" ? "T" : "YOU"}</div>
                  <div className="message-body">
                    <div className="message-author">{message.role === "assistant" ? "TITAN" : "YOU"}</div>
                    <div className="message-content">{message.content}</div>
                    {message.role === "assistant" && message.searched && <section className="source-panel" aria-label="Web research sources">
                      <div className="source-heading">WEB RESEARCH SOURCES <span>{message.sources?.length || 0}</span></div>
                      {message.sources?.length ? <ol className="source-list">
                        {message.sources.map((source, sourceIndex) => (
                          <li key={`${source.url}-${sourceIndex}`}>
                            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                            <span>{source.url}</span>
                          </li>
                        ))}
                      </ol> : <p className="source-empty">No source links were returned for this response. Verify important claims independently.</p>}
                    </section>}
                    {message.role === "assistant" && <div className="speech-controls">
                      <button type="button" onClick={() => speakingIndex === index ? stopSpeaking() : speakMessage(message.content, index)} aria-label={speakingIndex === index ? "Stop spoken response" : "Read response aloud"}>
                        {speakingIndex === index ? "■ Stop speaking" : "▶ Listen"}
                      </button>
                    </div>}
                  </div>
                </article>
              ))}
              {busy && <article className="message assistant"><div className="avatar">T</div><div className="message-body"><div className="message-author">TITAN</div><div className="typing"><i /><i /><i /></div></div></article>}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {!configured && <div className="setup-note">Interface ready · Add an API key on the server to activate TITAN.</div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask TITAN anything…"
              rows="1"
              disabled={busy}
            />
            <button className={`mic-button ${voiceState === "listening" ? "recording" : ""}`} type="button" onClick={toggleVoiceInput} disabled={busy || voiceState === "transcribing"} aria-label={voiceState === "listening" ? "Stop voice input" : "Start voice input"} title={voiceState === "listening" ? "Stop recording" : "Speak to TITAN"}>{voiceState === "listening" ? "■" : "🎙"}</button>
            <button className="send-button" type="submit" disabled={!input.trim() || busy || voiceState === "transcribing"} aria-label="Send message">↑</button>
          </form>
          {voiceMessage && <div className={`voice-status ${voiceState === "listening" ? "active" : ""}`} role="status">{voiceMessage}</div>}
          <div className="composer-tools">
            <label className="search-toggle">
              <input type="checkbox" checked={useWebSearch} onChange={(e) => setUseWebSearch(e.target.checked)} />
              <span className="toggle-track" />
              <span>Web search</span>
              <small>{useWebSearch ? "ON" : "OFF"}</small>
            </label>
            <label className="speech-toggle">
              <input type="checkbox" checked={autoSpeak} onChange={(e) => { setAutoSpeak(e.target.checked); if (!e.target.checked) stopSpeaking(); }} />
              <span>Read replies aloud</span>
            </label>
            <span className="composer-hint">Enter to send · Shift + Enter for new line</span>
          </div>
          <div className="composer-foot"><span>TITAN can make mistakes. Verify important information.</span><span>OPENAI API CONNECTION</span></div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
