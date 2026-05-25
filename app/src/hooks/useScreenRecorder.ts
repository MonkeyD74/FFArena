// src/hooks/useScreenRecorder.ts
// Hook unificado para Android (MediaProjection) e iOS (ReplayKit)
// Usar en cualquier componente de la app

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  Alert,
  Linking,
  PermissionsAndroid,
} from 'react-native';

// ─── Tipos ────────────────────────────────────────────────────────
export type Quality = '480p' | '720p' | '1080p';
export type RecordState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'done' | 'error';

export interface RecordingOptions {
  watermark?: boolean;
  playerName?: string;
  quality?: Quality;
}

export interface RecordingResult {
  path: string;
  size: number;       // bytes
  duration: number;   // segundos
}

export interface UseScreenRecorderReturn {
  state: RecordState;
  seconds: number;
  fps: number;
  isFFDetected: boolean;
  error: string | null;
  lastRecording: RecordingResult | null;
  requestPermission: () => Promise<boolean>;
  startRecording: (opts?: RecordingOptions) => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
}

// ─── Native Modules ───────────────────────────────────────────────
const AndroidRecorder = NativeModules.ScreenRecorder;   // ScreenRecorderModule.kt
const iOSRecorder     = NativeModules.ScreenRecorderBridge; // ScreenRecorderBridge.swift

// ─── Hook ─────────────────────────────────────────────────────────
export function useScreenRecorder(defaultOpts?: RecordingOptions): UseScreenRecorderReturn {
  const [state, setState]             = useState<RecordState>('idle');
  const [seconds, setSeconds]         = useState(0);
  const [fps, setFps]                 = useState(0);
  const [isFFDetected, setIsFFDetected] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<RecordingResult | null>(null);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const emitterRef  = useRef<NativeEventEmitter | null>(null);

  // ── Setup event listeners ──────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'android' && AndroidRecorder) {
      const emitter = new NativeEventEmitter(AndroidRecorder);
      emitterRef.current = emitter;

      const subs = [
        emitter.addListener('onRecordingStarted', () => {
          startTimer();
          setState('recording');
        }),
        emitter.addListener('onRecordingStopped', (data: { path: string; size: number }) => {
          stopTimer();
          const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
          setLastRecording({ path: data.path, size: data.size, duration });
          setState('done');
        }),
        emitter.addListener('onProjectionStopped', () => {
          // Usuario cerró "Stop sharing" desde la notificación del sistema
          stopTimer();
          setState('idle');
        }),
      ];
      return () => subs.forEach(s => s.remove());
    }

    if (Platform.OS === 'ios' && iOSRecorder) {
      const emitter = new NativeEventEmitter(iOSRecorder);
      emitterRef.current = emitter;

      const sub = emitter.addListener('onBroadcastEvent', async (data: { event: string; path?: string }) => {
        switch (data.event) {
          case 'started':
            startTimer();
            setState('recording');
            break;
          case 'finished':
            stopTimer();
            if (data.path) {
              const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
              setLastRecording({ path: data.path, size: 0, duration });
            }
            setState('done');
            break;
          case 'paused':
            stopTimer();
            break;
          case 'resumed':
            startTimer();
            break;
        }
      });
      return () => sub.remove();
    }
  }, []);

  // ── Detector de Free Fire (polling cada 5s) ────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android' || !AndroidRecorder) return;
    const check = async () => {
      try {
        const running = await AndroidRecorder.isFreefireRunning();
        setIsFFDetected(running);
      } catch { /* silencioso */ }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Timer interno ──────────────────────────────────────────────
  const startTimer = () => {
    startTimeRef.current = Date.now();
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // ─── requestPermission ─────────────────────────────────────────
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setError(null);

    if (Platform.OS === 'android') {
      if (!AndroidRecorder) {
        setError('Módulo nativo no disponible. Verifica el build.');
        return false;
      }
      // Android 13+ no requiere WRITE_EXTERNAL_STORAGE
      if (Platform.Version < 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setError('Permiso de almacenamiento denegado');
          return false;
        }
      }
      try {
        setState('requesting');
        const ok = await AndroidRecorder.requestPermission();
        setState(ok ? 'idle' : 'error');
        if (!ok) setError('Permiso de grabación de pantalla denegado');
        return ok;
      } catch (e: any) {
        setError(e.message || 'Error al pedir permiso');
        setState('error');
        return false;
      }
    }

    if (Platform.OS === 'ios') {
      if (!iOSRecorder) {
        setError('Módulo iOS no disponible. Verifica el build.');
        return false;
      }
      const available = await iOSRecorder.isAvailable();
      if (!available) {
        setError('Screen recording no disponible en este dispositivo');
        return false;
      }
      return true; // iOS pide permiso al iniciar el broadcast
    }

    return false;
  }, []);

  // ─── startRecording ────────────────────────────────────────────
  const startRecording = useCallback(async (opts?: RecordingOptions) => {
    const options = { ...defaultOpts, ...opts };
    setError(null);

    if (Platform.OS === 'android') {
      if (!AndroidRecorder) { setError('Módulo no disponible'); return; }
      setState('requesting');
      try {
        await AndroidRecorder.startRecording({
          watermark: options.watermark ?? true,
          playerName: options.playerName ?? 'Player',
          quality: options.quality ?? '720p',
        });
        // El evento 'onRecordingStarted' cambia el estado a 'recording'
      } catch (e: any) {
        setError(e.message);
        setState('error');
      }
    }

    if (Platform.OS === 'ios') {
      if (!iOSRecorder) { setError('Módulo iOS no disponible'); return; }
      setState('requesting');
      try {
        await iOSRecorder.startBroadcast({
          watermark: options.watermark ?? true,
          playerName: options.playerName ?? 'Player',
        });
        // El picker de iOS se abre — el usuario activa el broadcast
        // El evento 'onBroadcastEvent' con event='started' confirma inicio
      } catch (e: any) {
        setError(e.message);
        setState('error');
      }
    }
  }, [defaultOpts]);

  // ─── stopRecording ─────────────────────────────────────────────
  const stopRecording = useCallback(async (): Promise<RecordingResult | null> => {
    setState('stopping');
    try {
      if (Platform.OS === 'android' && AndroidRecorder) {
        await AndroidRecorder.stopRecording();
        // El evento 'onRecordingStopped' entrega el resultado
      }
      if (Platform.OS === 'ios' && iOSRecorder) {
        await iOSRecorder.stopBroadcast();
        // El evento 'onBroadcastEvent' con event='finished' entrega el path
      }
      return lastRecording;
    } catch (e: any) {
      setError(e.message);
      setState('error');
      return null;
    }
  }, [lastRecording]);

  return {
    state, seconds, fps, isFFDetected, error, lastRecording,
    requestPermission, startRecording, stopRecording,
  };
}
