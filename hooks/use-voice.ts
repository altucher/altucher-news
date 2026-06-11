'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// --- Text-to-Speech (Vocence with browser fallback) ---

export function useTextToSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setSpeakingId(null)
    setLoadingId(null)
  }, [])

  const speakWithBrowser = useCallback(
    (text: string, id: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        setSpeakingId(null)
        return
      }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1
      utterance.pitch = 1
      utterance.onend = () => setSpeakingId(null)
      utterance.onerror = () => setSpeakingId(null)
      setSpeakingId(id)
      window.speechSynthesis.speak(utterance)
    },
    []
  )

  const speak = useCallback(
    async (text: string, id: string) => {
      // Toggle off if already speaking this message
      if (speakingId === id || loadingId === id) {
        stop()
        return
      }
      stop()

      const cleanText = text
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/[*#_`>]/g, '')
        .trim()

      if (!cleanText) return

      setLoadingId(id)

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText }),
        })

        if (!res.ok) {
          // Vocence unavailable or not configured -> browser fallback
          setLoadingId(null)
          speakWithBrowser(cleanText, id)
          return
        }

        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          setSpeakingId(null)
          URL.revokeObjectURL(url)
        }
        audio.onerror = () => {
          setSpeakingId(null)
          URL.revokeObjectURL(url)
        }
        setLoadingId(null)
        setSpeakingId(id)
        await audio.play()
      } catch {
        setLoadingId(null)
        speakWithBrowser(cleanText, id)
      }
    },
    [speakingId, loadingId, stop, speakWithBrowser]
  )

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause()
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  return { speak, stop, speakingId, loadingId }
}

// --- Speech-to-Text (browser Web Speech API) ---

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

export function useSpeechToText(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
    if (SR) {
      setSupported(true)
      const recognition = new SR()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'
      recognition.onresult = (event) => {
        const transcript = Array.from({ length: event.results.length })
          .map((_, i) => event.results[i][0].transcript)
          .join(' ')
        if (transcript) onTranscript(transcript)
      }
      recognition.onerror = () => setListening(false)
      recognition.onend = () => setListening(false)
      recognitionRef.current = recognition
    }
    return () => {
      recognitionRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    if (listening) {
      recognition.stop()
      setListening(false)
    } else {
      try {
        recognition.start()
        setListening(true)
      } catch {
        setListening(false)
      }
    }
  }, [listening])

  return { toggle, listening, supported }
}
