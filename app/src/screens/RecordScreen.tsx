// src/screens/RecordScreen.tsx
// Pantalla de grabación para React Native (Android + iOS)
// Drop-in replacement del RecordTab del prototipo web

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Platform, ScrollView, Alert, Switch,
} from 'react-native';
import { useScreenRecorder, Quality } from '../hooks/useScreenRecorder';

// ─── Paleta (misma del prototipo) ─────────────────────────────────
const C = {
  bg: '#07080A', card: '#12151C', border: '#1E2130',
  gold: '#F0B429', goldDim: '#C8890A', text: '#E8EAF0',
  muted: '#4A5068', green: '#22C55E', red: '#EF4444',
};

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// ─── Componente ────────────────────────────────────────────────────
export default function RecordScreen() {
  const [quality, setQuality]       = useState<Quality>('720p');
  const [watermark, setWatermark]   = useState(true);
  const [permGranted, setPermGranted] = useState(false);

  const rec = useScreenRecorder({ playerName: 'PlayerOne_99' });

  // Pedir permiso al montar (Android pide en tiempo de uso, no instalación)
  useEffect(() => {
    rec.requestPermission().then(setPermGranted);
  }, []);

  const handleStart = async () => {
    if (!permGranted) {
      const ok = await rec.requestPermission();
      if (!ok) return;
      setPermGranted(true);
    }
    await rec.startRecording({ quality, watermark, playerName: 'PlayerOne_99' });
  };

  const handleStop = async () => {
    const result = await rec.stopRecording();
    if (result) {
      Alert.alert(
        '✅ Grabación guardada',
        `Duración: ${fmt(result.duration)}\nArchivo: ${result.path.split('/').pop()}`,
        [{ text: 'OK' }]
      );
    }
  };

  const isRecording = rec.state === 'recording';
  const isRequesting = rec.state === 'requesting' || rec.state === 'stopping';

  // ── Impacto en rendimiento ──────────────────────────────────────
  const PERF = [
    { label: 'Canvas WM (Android)', detail: '~3-5% CPU extra', ok: true },
    { label: 'Core Graphics WM (iOS)', detail: '~2-4% CPU (hardware)', ok: true },
    { label: `Encode ${quality}`, detail: quality === '1080p' ? '~9-13% CPU · baja FPS en low-end' : '~3-6% CPU · GPU accelerated', ok: quality !== '1080p' },
    { label: 'Free Fire en paralelo', detail: 'GPU compartida — sin diferencia perceptible en mid/high range', ok: true },
  ];

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

      {/* Free Fire detector (Android only) */}
      {Platform.OS === 'android' && (
        <View style={[s.card, { borderColor: rec.isFFDetected ? C.green + '55' : C.border, marginBottom: 12 }]}>
          <View style={s.row}>
            <View style={[s.dot, { backgroundColor: rec.isFFDetected ? C.green : '#333' }]} />
            <Text style={s.label}>
              Free Fire: {rec.isFFDetected ? 'DETECTADO ✓' : 'No detectado'}
            </Text>
          </View>
          {!rec.isFFDetected && (
            <Text style={s.muted}>Abre Free Fire antes de grabar para validación automática</Text>
          )}
        </View>
      )}

      {/* iOS nota */}
      {Platform.OS === 'ios' && (
        <View style={[s.card, { borderColor: C.gold + '33', marginBottom: 12 }]}>
          <Text style={[s.label, { color: C.gold, marginBottom: 4 }]}>REPLAYKIT · iOS</Text>
          <Text style={s.muted}>
            iOS graba toda la pantalla. Asegúrate de tener Free Fire abierto antes de activar el broadcast.
            El sistema mostrará el picker de "FFArena Live".
          </Text>
        </View>
      )}

      {/* Config */}
      {!isRecording && (
        <View style={[s.card, { marginBottom: 16 }]}>
          <Text style={[s.sectionTitle, { marginBottom: 12 }]}>CONFIGURACIÓN</Text>

          <Text style={[s.muted, { marginBottom: 8 }]}>CALIDAD</Text>
          <View style={s.row}>
            {(['480p', '720p', '1080p'] as Quality[]).map(q => (
              <TouchableOpacity
                key={q} onPress={() => setQuality(q)}
                style={[s.pill, quality === q && s.pillActive]}
              >
                <Text style={[s.pillText, quality === q && s.pillTextActive]}>{q}</Text>
                {q === '720p' && <Text style={[s.pillSub, { color: C.green }]}>RECO</Text>}
                {q === '1080p' && <Text style={[s.pillSub, { color: '#F59E0B' }]}>+CPU</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <View style={[s.row, { justifyContent: 'space-between', marginTop: 16 }]}>
            <View>
              <Text style={s.label}>Marca de agua</Text>
              <Text style={s.muted}>FFARENA + usuario + timestamp</Text>
            </View>
            <Switch
              value={watermark}
              onValueChange={setWatermark}
              trackColor={{ false: C.border, true: C.gold }}
              thumbColor="#fff"
            />
          </View>
        </View>
      )}

      {/* Estado grabando */}
      {isRecording && (
        <View style={[s.card, { borderColor: C.red + '66', alignItems: 'center', marginBottom: 16 }]}>
          <View style={[s.row, { marginBottom: 8 }]}>
            <View style={[s.dot, { backgroundColor: C.red, width: 10, height: 10 }]} />
            <Text style={[s.label, { color: C.red }]}>GRABANDO</Text>
          </View>
          <Text style={s.timer}>{fmt(rec.seconds)}</Text>
          <Text style={s.muted}>{quality}{watermark ? ' · 🔏 WM' : ''}</Text>
          {rec.error && <Text style={[s.muted, { color: '#F59E0B', marginTop: 4 }]}>⚠️ {rec.error}</Text>}
        </View>
      )}

      {/* Permiso pendiente */}
      {rec.state === 'requesting' && (
        <View style={[s.card, { borderColor: C.gold + '44', alignItems: 'center', marginBottom: 16 }]}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🔐</Text>
          <Text style={s.label}>Esperando permiso del sistema…</Text>
          <Text style={[s.muted, { textAlign: 'center', marginTop: 4 }]}>
            {Platform.OS === 'android'
              ? 'Acepta el diálogo y selecciona la pantalla'
              : 'Selecciona "FFArena Live" en el picker'}
          </Text>
        </View>
      )}

      {/* Error */}
      {rec.state === 'error' && rec.error && (
        <View style={[s.card, { borderColor: C.red + '44', marginBottom: 16 }]}>
          <Text style={[s.label, { color: C.red, marginBottom: 6 }]}>❌ Error</Text>
          <Text style={s.muted}>{rec.error}</Text>
        </View>
      )}

      {/* Botón principal */}
      {!isRecording && !isRequesting && (
        <TouchableOpacity onPress={handleStart} style={s.btnRec} activeOpacity={0.8}>
          <Text style={s.btnText}>⏺  INICIAR GRABACIÓN</Text>
        </TouchableOpacity>
      )}
      {isRecording && (
        <TouchableOpacity onPress={handleStop} style={s.btnStop} activeOpacity={0.8}>
          <Text style={[s.btnText, { color: C.red }]}>⏹  DETENER Y GUARDAR</Text>
        </TouchableOpacity>
      )}

      {/* Impacto en rendimiento */}
      <Text style={[s.sectionTitle, { marginTop: 24, marginBottom: 10 }]}>IMPACTO EN RENDIMIENTO</Text>
      <View style={s.card}>
        {PERF.map((p, i) => (
          <View key={i} style={[s.perfRow, i < PERF.length - 1 && s.borderBottom]}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{p.label}</Text>
              <Text style={s.muted}>{p.detail}</Text>
            </View>
            <Text style={[s.badge, { color: p.ok ? C.green : '#F59E0B' }]}>
              {p.ok ? 'BAJO' : 'MEDIO'}
            </Text>
          </View>
        ))}
      </View>

      <View style={[s.card, { borderColor: C.green + '22', marginTop: 12 }]}>
        <Text style={s.muted}>
          💡 <Text style={{ color: C.text }}>Conclusión:</Text> A 720p el impacto total es ~5-8% CPU.
          La marca de agua añade {'<'}1%. No afecta Free Fire en dispositivos mid/high-range.
          En low-end, usar 480p.
        </Text>
      </View>

    </ScrollView>
  );
}

// ─── Estilos ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg },
  card:         { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: C.muted },
  label:        { fontSize: 12, fontWeight: '700', color: C.text },
  muted:        { fontSize: 11, color: C.muted, lineHeight: 16 },
  sectionTitle: { fontSize: 10, color: C.muted, letterSpacing: 2 },
  timer:        { fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 42, fontWeight: '900', color: C.red, marginVertical: 4 },
  pill:         { flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, alignItems: 'center' },
  pillActive:   { backgroundColor: C.gold + '18', borderColor: C.gold },
  pillText:     { fontSize: 12, fontWeight: '800', color: C.muted },
  pillTextActive: { color: C.gold },
  pillSub:      { fontSize: 9, marginTop: 2 },
  btnRec:       { backgroundColor: C.red, borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 16, shadowColor: C.red, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
  btnStop:      { backgroundColor: C.card, borderWidth: 1, borderColor: C.red, borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 16 },
  btnText:      { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  perfRow:      { paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  borderBottom: { borderBottomWidth: 1, borderBottomColor: C.border },
  badge:        { fontSize: 9, fontWeight: '800', letterSpacing: 1, borderWidth: 1, borderColor: C.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
});
