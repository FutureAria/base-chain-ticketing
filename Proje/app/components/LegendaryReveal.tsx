import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
const whatTheHoImg =
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=900&q=80";

interface Props {
  show: boolean;
  onClose: () => void;
}

// ── Web Audio: tavern rumble + reverb ──
function playTavernRumble() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Synthetic reverb impulse (large stone room)
    const makeReverb = (duration = 2.5, decay = 2.8) => {
      const len = Math.floor(ctx.sampleRate * duration);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      return conv;
    };

    // Low bass chest-rumble (50–90 Hz blend)
    const addBass = (freq: number, start: number, dur: number, vol: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const rev  = makeReverb();
      const mix  = ctx.createGain(); // wet/dry

      osc.type = "triangle";
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(vol,   ctx.currentTime + start + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);

      mix.gain.value = 0.45; // reverb mix

      osc.connect(gain);
      gain.connect(ctx.destination); // dry
      gain.connect(rev);
      rev.connect(mix);
      mix.connect(ctx.destination);  // wet

      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.1);
    };

    // Layered bass hits timed to speech lines
    addBass(55,  0.45, 3.5, 0.22); // first "와아아아!"
    addBass(70,  0.45, 3.0, 0.14);
    addBass(48,  1.35, 2.8, 0.18); // second line
    addBass(62,  2.70, 2.5, 0.15); // third line

    // Extra punch transient at burst moment
    const punch = ctx.createOscillator();
    const pGain = ctx.createGain();
    punch.type = "sine";
    punch.frequency.setValueAtTime(120, ctx.currentTime + 0.45);
    punch.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.75);
    pGain.gain.setValueAtTime(0.35, ctx.currentTime + 0.45);
    pGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.85);
    punch.connect(pGain);
    pGain.connect(ctx.destination);
    punch.start(ctx.currentTime + 0.45);
    punch.stop(ctx.currentTime + 1.0);
  } catch { /* Web Audio API 미지원 브라우저에서는 효과음을 생략한다 */ }
}

// ── Web Speech: find deepest male Korean voice ──
function speakTavernKeeper() {
  try {
    window.speechSynthesis.cancel();

    // Bass audio plays separately (can't route TTS through Web Audio)
    playTavernRumble();

    const MALE_PATTERNS = [
      "injoon", "hyun", "youngmin", "kyoungmin", "남성", "male", "man",
      "daniel", "david", "james", "george", "mark", "seojun", "junho",
    ];

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      // 1st priority: Korean male
      const koMale = voices.find(
        v => v.lang.startsWith("ko") &&
             MALE_PATTERNS.some(p => v.name.toLowerCase().includes(p))
      );
      if (koMale) return koMale;
      // 2nd priority: Microsoft InJoon (male ko-KR on Windows)
      const injoon = voices.find(v => /injoon/i.test(v.name));
      if (injoon) return injoon;
      // 3rd priority: any Korean voice (will be pitched down to near-bass)
      const ko = voices.find(v => v.lang.startsWith("ko"));
      if (ko) return ko;
      // 4th priority: deep English male as fallback
      return voices.find(
        v => v.lang.startsWith("en") &&
             ["david", "mark", "daniel", "james", "george", "fred", "alex", "bruce"]
               .some(p => v.name.toLowerCase().includes(p))
      ) ?? null;
    };

    // Lines with timing — short bursts sound more dramatic at low pitch
    const lines = [
      { text: "와아아아!",               delay:  500 },
      { text: "전설 밈 코인이다!!",        delay: 1400 },
      { text: "허허허... 이런 녀석을 보게 되다니!", delay: 2900 },
    ];

    const doSpeak = () => {
      const voice = pickVoice();
      lines.forEach(({ text, delay }) => {
        setTimeout(() => {
          const u      = new SpeechSynthesisUtterance(text);
          u.lang       = "ko-KR";
          u.pitch      = 0.1;   // absolute floor — maximum depth
          u.rate       = 0.58;  // slow, deliberate, gravelly
          u.volume     = 1;
          if (voice) u.voice = voice;
          window.speechSynthesis.speak(u);
        }, delay);
      });
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener("voiceschanged", doSpeak, { once: true });
    } else {
      doSpeak();
    }
  } catch { /* TTS 미지원 환경에서는 음성 안내를 생략한다 */ }
}

const RAY_COUNT = 18;
const THICK_INDICES = new Set([0, 3, 6, 9, 12, 15]);

export function LegendaryReveal({ show, onClose }: Props) {
  // phase: 0=idle, 1=box-shaking, 2=burst, 3=coin
  const [phase, setPhase] = useState(0);

  const handleClose = useCallback(() => {
    window.speechSynthesis?.cancel();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!show) { setPhase(0); return; }

    setPhase(1);
    const t1 = setTimeout(() => setPhase(2), 1600);
    const t2 = setTimeout(() => setPhase(3), 2200);
    const tts = setTimeout(() => speakTavernKeeper(), 1700);
    const auto = setTimeout(() => handleClose(), 9000);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(tts); clearTimeout(auto);
      window.speechSynthesis?.cancel();
    };
  }, [show, handleClose]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, #1a0800 0%, #0d0000 50%, #000 100%)",
          }}
        >
          {/* ── Ambient warm glow at center (phase 2+) ── */}
          <AnimatePresence>
            {phase >= 2 && (
              <motion.div
                key="glow"
                initial={{ opacity: 0, scale: 0.2 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <motion.div
                  animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  className="rounded-full"
                  style={{
                    width: "45vw",
                    height: "45vw",
                    background:
                      "radial-gradient(circle, rgba(255,210,60,0.55) 0%, rgba(255,120,0,0.35) 40%, transparent 70%)",
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Light Rays (phase 2+) ── */}
          <AnimatePresence>
            {phase >= 2 && (
              <motion.div
                key="rays"
                className="absolute inset-0 pointer-events-none overflow-hidden"
                animate={{ rotate: 360 }}
                transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
              >
                {Array.from({ length: RAY_COUNT }).map((_, i) => {
                  const angle = (i * 360) / RAY_COUNT;
                  const isThick = THICK_INDICES.has(i);
                  return (
                    <div
                      key={i}
                      className="absolute"
                      style={{
                        top: "50%",
                        left: "50%",
                        width: isThick ? "9px" : "3px",
                        height: "75vh",
                        marginLeft: isThick ? "-4.5px" : "-1.5px",
                        transform: `rotate(${angle}deg)`,
                        transformOrigin: "top center",
                      }}
                    >
                      <motion.div
                        className="w-full h-full"
                        initial={{ scaleY: 0, opacity: 0 }}
                        animate={{ scaleY: 1, opacity: isThick ? 0.92 : 0.55 }}
                        transition={{
                          duration: 0.55,
                          ease: "easeOut",
                          delay: i * 0.018,
                        }}
                        style={{
                          transformOrigin: "top center",
                          background: isThick
                            ? "linear-gradient(to bottom, rgba(255,210,0,1), rgba(255,140,0,0.5) 60%, transparent)"
                            : "linear-gradient(to bottom, rgba(255,180,0,0.8), rgba(255,100,0,0.2) 60%, transparent)",
                        }}
                      />
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Secondary rays (slightly offset angle, phase 2+) ── */}
          <AnimatePresence>
            {phase >= 2 && (
              <motion.div
                key="rays2"
                className="absolute inset-0 pointer-events-none overflow-hidden"
                animate={{ rotate: -360 }}
                transition={{ duration: 55, repeat: Infinity, ease: "linear" }}
              >
                {Array.from({ length: 10 }).map((_, i) => {
                  const angle = (i * 360) / 10 + 18;
                  return (
                    <div
                      key={i}
                      className="absolute"
                      style={{
                        top: "50%",
                        left: "50%",
                        width: "2px",
                        height: "55vh",
                        marginLeft: "-1px",
                        transform: `rotate(${angle}deg)`,
                        transformOrigin: "top center",
                      }}
                    >
                      <motion.div
                        className="w-full h-full"
                        initial={{ scaleY: 0, opacity: 0 }}
                        animate={{ scaleY: 1, opacity: 0.4 }}
                        transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.025 + 0.1 }}
                        style={{
                          transformOrigin: "top center",
                          background:
                            "linear-gradient(to bottom, rgba(255,240,100,0.8), transparent)",
                        }}
                      />
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Phase 1: Shaking Box ── */}
          <AnimatePresence>
            {phase === 1 && (
              <motion.div
                key="box"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{
                  scale: [0.5, 1.1, 1],
                  opacity: 1,
                }}
                exit={{ scale: 2, opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="relative"
              >
                {/* Box glow */}
                <motion.div
                  animate={{
                    boxShadow: [
                      "0 0 20px rgba(255,150,0,0.3)",
                      "0 0 60px rgba(255,150,0,0.8)",
                      "0 0 20px rgba(255,150,0,0.3)",
                    ],
                  }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  className="rounded-3xl p-4"
                >
                  <motion.div
                    animate={{
                      rotate: [-4, 4, -6, 6, -4, 4, -8, 8, -4, 4],
                      y: [0, -6, 0, -10, 0, -14, 0],
                      x: [-2, 2, -3, 3, -4, 4, -2, 2],
                    }}
                    transition={{
                      duration: 0.15,
                      repeat: Infinity,
                      repeatType: "mirror",
                    }}
                    className="text-[140px] select-none leading-none"
                    style={{ filter: "drop-shadow(0 0 30px rgba(255,180,0,0.8))" }}
                  >
                    📦
                  </motion.div>
                </motion.div>

                {/* Crack lines appearing */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0, 0.3, 0.7, 1] }}
                  transition={{ duration: 1.2, times: [0, 0.4, 0.6, 0.8, 1] }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  style={{ fontSize: 140 }}
                >
                  <span style={{ filter: "drop-shadow(0 0 12px rgba(255,255,100,0.9))" }}>
                    ✨
                  </span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Phase 2: Burst Flash ── */}
          <AnimatePresence>
            {phase === 2 && (
              <motion.div
                key="burst"
                initial={{ scale: 0.5, opacity: 1 }}
                animate={{ scale: [1, 4], opacity: [1, 0] }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="rounded-full pointer-events-none"
                style={{
                  width: "200px",
                  height: "200px",
                  background:
                    "radial-gradient(circle, rgba(255,255,200,1) 0%, rgba(255,180,0,0.8) 30%, rgba(255,100,0,0.4) 60%, transparent 80%)",
                }}
              />
            )}
          </AnimatePresence>

          {/* ── Phase 3: Coin Reveal ── */}
          <AnimatePresence>
            {phase >= 3 && (
              <motion.div
                key="coin"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 90, damping: 14 }}
                className="relative flex flex-col items-center gap-5 z-10"
              >
                {/* "전설" badge */}
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex items-center gap-2 px-5 py-1.5 rounded-full font-black tracking-widest text-sm"
                  style={{
                    background: "linear-gradient(90deg, #ffaa00, #ff8800, #ffcc00, #ff8800, #ffaa00)",
                    backgroundSize: "200% 100%",
                    animation: "shimmer 2s linear infinite",
                    boxShadow: "0 0 24px rgba(255,170,0,0.9), 0 0 50px rgba(255,120,0,0.5)",
                    color: "#fff",
                    textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                  }}
                >
                  ✦ 전 설 밈 코 인 ✦
                </motion.div>

                {/* Coin Image */}
                <motion.div
                  className="relative"
                  animate={{ rotateY: [0, 6, -6, 3, -3, 0] }}
                  transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    repeatDelay: 1,
                  }}
                >
                  {/* Outer ring glow */}
                  <motion.div
                    animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute -inset-4 rounded-full pointer-events-none"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(255,200,0,0.4) 30%, transparent 70%)",
                      boxShadow:
                        "0 0 50px rgba(255,180,0,0.7), 0 0 100px rgba(255,100,0,0.35)",
                    }}
                  />

                  <img
                    src={whatTheHoImg}
                    alt="WHAT THE HO"
                    className="relative z-10 rounded-full object-cover"
                    style={{
                      width: "clamp(220px, 30vw, 320px)",
                      height: "clamp(220px, 30vw, 320px)",
                      boxShadow:
                        "0 0 40px rgba(255,200,0,0.75), 0 0 80px rgba(255,100,0,0.4), inset 0 0 40px rgba(255,220,0,0.15)",
                      filter: "drop-shadow(0 0 20px rgba(255,200,50,0.8))",
                    }}
                  />

                  {/* Rainbow shimmer sweep */}
                  <motion.div
                    className="absolute inset-0 rounded-full overflow-hidden z-20 pointer-events-none"
                    animate={{ x: ["-120%", "220%"] }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      repeatDelay: 2,
                      ease: "easeInOut",
                    }}
                    style={{
                      background:
                        "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)",
                    }}
                  />

                  {/* Floating sparkles around coin */}
                  {[0, 60, 120, 180, 240, 300].map((deg, si) => (
                    <motion.div
                      key={si}
                      className="absolute text-xl pointer-events-none"
                      style={{
                        top: "50%",
                        left: "50%",
                        transform: `rotate(${deg}deg) translateY(-${si % 2 === 0 ? "175" : "155"}px) rotate(-${deg}deg)`,
                      }}
                      animate={{
                        opacity: [0, 1, 0],
                        scale: [0.5, 1.2, 0.5],
                        y: [0, -10, 0],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        delay: si * 0.3,
                        ease: "easeInOut",
                      }}
                    >
                      {si % 3 === 0 ? "✨" : si % 3 === 1 ? "⭐" : "💫"}
                    </motion.div>
                  ))}
                </motion.div>

                {/* Title: WHAT THE HO */}
                <motion.h1
                  initial={{ opacity: 0, y: 20, letterSpacing: "0.05em" }}
                  animate={{ opacity: 1, y: 0, letterSpacing: "0.18em" }}
                  transition={{ delay: 0.5, duration: 0.6 }}
                  className="font-black text-center"
                  style={{
                    fontSize: "clamp(28px, 5vw, 52px)",
                    background:
                      "linear-gradient(90deg, #ffaa00 0%, #fff8c0 30%, #ffcc00 50%, #fff8c0 70%, #ffaa00 100%)",
                    backgroundSize: "200% 100%",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    filter: "drop-shadow(0 0 16px rgba(255,210,0,0.9))",
                    animation: "shimmer 3s linear infinite",
                  }}
                >
                  WHAT THE HO
                </motion.h1>

                {/* Sub-text */}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-[#ffcc44] tracking-widest text-center"
                  style={{
                    textShadow:
                      "0 0 10px rgba(255,200,0,0.9), 0 0 20px rgba(255,150,0,0.6)",
                  }}
                >
                  전설 밈 NFT 획득! 🎊
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Close Button ── */}
          <AnimatePresence>
            {phase >= 3 && (
              <motion.button
                key="close"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: 1.5 }}
                onClick={handleClose}
                className="absolute top-6 right-6 w-12 h-12 rounded-full flex items-center justify-center text-[#ffaa00] hover:scale-110 transition-transform z-30"
                style={{
                  background: "rgba(255,170,0,0.12)",
                  border: "1px solid rgba(255,170,0,0.5)",
                  boxShadow: "0 0 16px rgba(255,170,0,0.3)",
                }}
              >
                <X className="w-6 h-6" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* ── Click anywhere to close (phase 3 only) ── */}
          {phase >= 3 && (
            <div
              className="absolute inset-0 z-0 cursor-pointer"
              onClick={handleClose}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
