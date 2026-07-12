import React, { useState, useEffect } from "react";
import { 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack, 
  Volume2, 
  Layers, 
  ShieldAlert, 
  Clock, 
  Plus, 
  Trash2, 
  HelpCircle, 
  CheckCircle, 
  ListMusic, 
  RefreshCw, 
  AlertTriangle, 
  Settings, 
  ArrowRightLeft, 
  LogOut, 
  Lock,
  ChevronDown
} from "lucide-react";

interface ModuleInfo {
  name: string;
  desc: string;
}

interface BotStatus {
  botOnline: boolean;
  tokenConfigured: boolean;
  version: string;
  modules: ModuleInfo[];
  limits: {
    maxQueue: number;
    rateLimitMs: number;
  };
}

interface SimulatedTrack {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  requester: string;
}

// Initial default playlist
const DEFAULT_TRACKS: SimulatedTrack[] = [
  {
    id: "t1",
    title: "Analog Horror Funk (6 7) - DJ Raulipues (Slowed + Reverb)",
    author: "Ezro ❤️",
    thumbnail: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=120&auto=format&fit=crop&q=60",
    requester: "أحمد (احمد NTL)"
  },
  {
    id: "t2",
    title: "مهرجان مسجون حزين مين سمعني حمو الطيخا",
    author: "Mostafa Ali 🎤",
    thumbnail: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&auto=format&fit=crop&q=60",
    requester: "يوسف"
  },
  {
    id: "t3",
    title: "Arabic Oud Lo-Fi Meditation Beats",
    author: "NTL Sound Beats",
    thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=120&auto=format&fit=crop&q=60",
    requester: "أحمد (احمد NTL)"
  }
];

export default function App() {
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // User control & simulation state
  const [currentSimUser, setCurrentSimUser] = useState("أحمد (احمد NTL)");
  const [userInVoice, setUserInVoice] = useState(true);

  // Simulator State
  const [currentTrack, setCurrentTrack] = useState<SimulatedTrack | null>(DEFAULT_TRACKS[0]);
  const [queue, setQueue] = useState<SimulatedTrack[]>(DEFAULT_TRACKS.slice(1));
  const [history, setHistory] = useState<SimulatedTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLooping, setIsLooping] = useState(false);
  const [hasVoiceUsers, setHasVoiceUsers] = useState(true);
  
  // Custom Song Add Form
  const [inputTitle, setInputTitle] = useState("");
  const [inputAuthor, setInputAuthor] = useState("");

  // System Notifications/Warnings
  const [simulatedMessages, setSimulatedMessages] = useState<{ id: string; text: string; type: "info" | "success" | "warning" | "error" | "voice" }[]>([]);
  const [lastInteractionTime, setLastInteractionTime] = useState<number>(0);
  const [isSpamBlocked, setIsSpamBlocked] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Sleek Interface Additions
  const [trackSeconds, setTrackSeconds] = useState(0);
  const [isSelectMenuOpen, setIsSelectMenuOpen] = useState(false);
  const trackDuration = 243; // 4:03 (243 seconds)

  // Track progress simulation ticker
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && currentTrack) {
      interval = setInterval(() => {
        setTrackSeconds((prev) => {
          if (prev >= trackDuration) {
            if (isLooping) {
              addSimulatedMessage("🔁 [تكرار تلقائي] تم إعادة تشغيل الأغنية الحالية تلقائياً من البداية.", "success");
              return 0;
            } else {
              // Trigger auto-skip when track ends
              setTimeout(() => {
                handleNext();
              }, 100);
              return 0;
            }
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentTrack, isLooping, queue]);

  // Reset track timer on song change
  useEffect(() => {
    setTrackSeconds(0);
  }, [currentTrack]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  };

  // Load backend status if available
  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((data: BotStatus) => {
        setBotStatus(data);
        setLoadingStatus(false);
      })
      .catch((err) => {
        console.warn("Express backend status offline or not compiled yet:", err);
        setLoadingStatus(false);
      });
  }, []);

  // Cooldown effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (cooldownRemaining > 0) {
      interval = setInterval(() => {
        setCooldownRemaining((prev) => {
          if (prev <= 0.1) {
            setIsSpamBlocked(false);
            return 0;
          }
          return prev - 0.1;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [cooldownRemaining]);

  // Handle Voice Channel Empty Simulation
  const handleVoiceUsersToggle = (checked: boolean) => {
    setHasVoiceUsers(checked);
    if (!checked) {
      // Clean up player
      setCurrentTrack(null);
      setQueue([]);
      setIsPlaying(false);
      setIsLooping(false);
      addSimulatedMessage("🚪 غادرت الروم الصوتي لعدم وجود أعضاء فيه.", "voice");
    } else {
      // Re-initialize default
      setCurrentTrack(DEFAULT_TRACKS[0]);
      setQueue(DEFAULT_TRACKS.slice(1));
      setIsPlaying(true);
      addSimulatedMessage("🔊 تم الدخول للروم الصوتي وجاري الاتصال بسيرفر Lavalink.", "info");
    }
  };

  const addSimulatedMessage = (text: string, type: "info" | "success" | "warning" | "error" | "voice" = "info") => {
    const newMessage = {
      id: Math.random().toString(),
      text,
      type
    };
    setSimulatedMessages((prev) => [newMessage, ...prev].slice(0, 10));
  };

  // Cooldown rate-limit checker for user actions
  const checkInteractionRateLimit = (): boolean => {
    const now = Date.now();
    const limit = 1500; // 1.5 seconds cooldown
    if (now - lastInteractionTime < limit) {
      setIsSpamBlocked(true);
      setCooldownRemaining(1.5);
      addSimulatedMessage("⚠️ يرجى عدم العبث بالبوت والضغط على الأزرار بشكل متكرر وسريع! تم تفعيل نظام الحماية الذاتي ضد التخريب.", "warning");
      return false;
    }
    setLastInteractionTime(now);
    return true;
  };

  const checkUserVoiceStatus = (): boolean => {
    if (!userInVoice) {
      addSimulatedMessage("❌ يجب أن تكون في نفس الروم الصوتي للتحكم بالبوت!", "error");
      return false;
    }
    return true;
  };

  // Add song to queue
  const handleAddSong = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputTitle.trim()) return;

    if (!checkUserVoiceStatus()) return;

    if (!hasVoiceUsers) {
      // If voice was empty or disconnected, automatically connect on song addition
      setHasVoiceUsers(true);
      addSimulatedMessage("🔊 تم الدخول للروم الصوتي وجاري الاتصال بسيرفر Lavalink.", "info");
    }

    // Check maximum queue limit of 5 songs
    if (queue.length >= 5) {
      addSimulatedMessage("❌ لا يمكن إضافة الأغنية! لقد بلغت الحد الأقصى المسموح به (5 أغاني فقط في قائمة الانتظار).", "error");
      return;
    }

    const newTrack: SimulatedTrack = {
      id: Date.now().toString(),
      title: inputTitle,
      author: inputAuthor || "Unknown Artist",
      thumbnail: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=120&auto=format&fit=crop&q=60",
      requester: currentSimUser
    };

    if (!currentTrack) {
      setCurrentTrack(newTrack);
      setIsPlaying(true);
      addSimulatedMessage(`🎶 جاري تشغيل: ${newTrack.title}`, "success");
      addSimulatedMessage("📨 [إرسال] تم إرسال ايمبد التشغيل الفردي الجديد (Now Playing).", "success");
    } else {
      const isFirstQueueItem = queue.length === 0;
      setQueue((prev) => [...prev, newTrack]);
      addSimulatedMessage(`➕ تم إضافة الأغنية إلى قائمة الانتظار: ${newTrack.title} بواسطة (${currentSimUser})`, "info");
      
      if (isFirstQueueItem) {
        addSimulatedMessage("🗑️ [حذف] تم حذف ايمبد التشغيل الفردي السابق لتهيئة قائمة الانتظار.", "warning");
        addSimulatedMessage("📨 [إرسال] تم إرسال ايمبد التشغيل المطور وايمبد قائمة الانتظار الجديد بالكامل.", "success");
      } else {
        addSimulatedMessage("📝 [تعديل] تم تعديل ايمبد قائمة الانتظار الحالي لإضافة الأغنية الجديدة دون حذف الرسالة.", "info");
      }
    }

    setInputTitle("");
    setInputAuthor("");
  };

  // Skip Forward
  const handleNext = () => {
    if (!checkUserVoiceStatus()) return;
    if (!checkInteractionRateLimit()) return;
    if (!currentTrack) return;

    if (isSpamBlocked) return;

    // Track Loop repetition logic
    if (isLooping) {
      // Repeat current track infinitely
      addSimulatedMessage(`🔁 [تكرار تلقائي] تم إعادة تشغيل الأغنية الحالية: ${currentTrack.title}`, "success");
      return;
    }

    const nextQueue = [...queue];
    const prevTrack = currentTrack;
    
    if (nextQueue.length > 0) {
      const nextTrack = nextQueue.shift()!;
      setQueue(nextQueue);
      setHistory((prev) => [...prev, prevTrack]);
      setCurrentTrack(nextTrack);
      setIsPlaying(true);
      addSimulatedMessage(`⏭️ جاري تشغيل الأغنية التالية: ${nextTrack.title}`, "success");
      addSimulatedMessage("📝 [تعديل] تم تشغيل الأغنية التالية وتعديل اسم وصورة الأغنية في الايمبد النشط مباشرة دون إعادة إرساله.", "info");
    } else {
      setCurrentTrack(null);
      setIsPlaying(false);
      addSimulatedMessage("🗑️ [حذف] تم حذف رسالة الايمبد المزدوج السابقة لانتهاء قائمة الانتظار.", "warning");
      addSimulatedMessage("📨 [إرسال] تم إرسال ايمبد التشغيل الفردي الجديد (Now Playing) بعد تصفير قائمة الانتظار.", "success");
      addSimulatedMessage("🎵 انتهت جميع الأغاني في قائمة الانتظار.", "info");
    }
  };

  // Skip Backward
  const handlePrev = () => {
    if (!checkUserVoiceStatus()) return;
    if (!checkInteractionRateLimit()) return;
    if (history.length === 0) {
      addSimulatedMessage("❌ لا توجد أغاني سابقة في الذاكرة لتشغيلها!", "error");
      return;
    }

    const prevQueue = [...queue];
    const prevHistory = [...history];
    const lastPlayed = prevHistory.pop()!;

    if (currentTrack) {
      prevQueue.unshift(currentTrack);
    }

    const isFirstQueueItem = queue.length === 0;

    setHistory(prevHistory);
    setQueue(prevQueue);
    setCurrentTrack(lastPlayed);
    setIsPlaying(true);
    addSimulatedMessage(`⏮️ جاري تشغيل الأغنية السابقة: ${lastPlayed.title}`, "success");
    
    if (isFirstQueueItem) {
      addSimulatedMessage("🗑️ [حذف] تم حذف ايمبد التشغيل الفردي السابق لتهيئة قائمة الانتظار.", "warning");
      addSimulatedMessage("📨 [إرسال] تم إرسال ايمبد التشغيل المطور وايمبد قائمة الانتظار الجديد بالكامل.", "success");
    } else {
      addSimulatedMessage("📝 [تعديل] تم تعديل ايمبد قائمة الانتظار الحالي لإضافة الأغنية السابقة دون حذف الرسالة.", "info");
    }
  };

  // Toggle Pause/Play
  const handleTogglePlay = () => {
    if (!checkUserVoiceStatus()) return;
    if (!checkInteractionRateLimit()) return;
    if (!currentTrack) {
      addSimulatedMessage("❌ لا توجد أغنية تعمل حالياً لتشغيلها أو إيقافها!", "error");
      return;
    }

    // Check permission: only requester can pause/play
    if (currentTrack.requester !== currentSimUser) {
      addSimulatedMessage(`❌ لا يمكنك التحكم بوضع التشغيل المؤقت! فقط العضو الذي طلب الأغنية (${currentTrack.requester}) يمكنه إيقافها/تشغيلها مؤقتاً.`, "error");
      return;
    }

    setIsPlaying(!isPlaying);
    addSimulatedMessage(
      isPlaying ? `⏸️ تم إيقاف الأغنية مؤقتاً: ${currentTrack.title}` : `▶️ تم استئناف الأغنية: ${currentTrack.title}`,
      "info"
    );
  };

  // Toggle Track loop (repetition)
  const handleToggleLoop = () => {
    if (!checkUserVoiceStatus()) return;
    if (!checkInteractionRateLimit()) return;
    if (!currentTrack) {
      addSimulatedMessage("❌ لا توجد أغنية قيد التشغيل لتفعيل التكرار عليها!", "error");
      return;
    }
    const nextState = !isLooping;
    setIsLooping(nextState);
    if (nextState) {
      addSimulatedMessage(`🔁 تم تفعيل التكرار التلقائي للأغنية بنجاح! ستعاد بشكل لا نهائي تلقائياً.`, "success");
    } else {
      addSimulatedMessage(`❌ تم إيقاف التكرار التلقائي للأغنية.`, "info");
    }
  };

  // Disconnect Bot
  const handleDisconnect = () => {
    if (!checkUserVoiceStatus()) return;
    if (!checkInteractionRateLimit()) return;

    setCurrentTrack(null);
    setQueue([]);
    setHistory([]);
    setIsPlaying(false);
    setIsLooping(false);
    setHasVoiceUsers(false);
    addSimulatedMessage("🚪 <:Disconnect:1520462158213681313> [ديسكونكت] غادر البوت الروم الصوتي وتم تصفير قائمة الانتظار ونسيانها تماماً.", "voice");
  };

  return (
    <div className="flex h-screen w-full bg-[#1e1f22] text-[#dbdee1] font-sans overflow-hidden select-none" dir="rtl">
      
      {/* 1. Left Sidebar: Server Icons (Mockup) */}
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 border-l border-black/20 shrink-0 hidden sm:flex">
        <div className="w-12 h-12 bg-[#5865f2] rounded-2xl flex items-center justify-center text-white text-lg font-bold hover:bg-[#5865f2] cursor-pointer transition-all shadow-md">
          M
        </div>
        <div className="w-8 h-[2px] bg-[#35363c] rounded-full mx-auto my-1"></div>
        <div className="w-12 h-12 bg-[#313338] rounded-[24px] hover:rounded-2xl transition-all flex items-center justify-center text-[#dbdee1] border border-white/5 font-bold hover:bg-[#5865f2] hover:text-white cursor-pointer">
          NTL
        </div>
        <div className="w-12 h-12 bg-[#313338] rounded-[24px] hover:rounded-2xl transition-all flex items-center justify-center text-emerald-500 border border-white/5 text-xl font-bold hover:bg-emerald-500 hover:text-white cursor-pointer">
          +
        </div>
      </div>

      {/* 2. Middle Sidebar: Channels, Configuration & Schedulers */}
      <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 border-l border-black/20 hidden md:flex text-right">
        {/* Header Title */}
        <div className="h-12 border-b border-black/20 flex items-center justify-between px-4 font-bold text-white shadow-sm shrink-0">
          <span className="truncate text-sm font-sans">لوحة تحكم الموسيقى</span>
          <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/30 font-mono">v2.1.0</span>
        </div>

        {/* Channels / Modules Scrollable */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          
          {/* Active Channel State */}
          <div>
            <div className="text-[10px] uppercase font-bold text-[#949ba4] px-1 mb-2 tracking-wider">الروم الصوتي الحالي</div>
            <div className={`px-2 py-2 rounded flex items-center justify-between transition-colors ${hasVoiceUsers ? "bg-[#35373c] text-white" : "bg-[#2b2d31] text-gray-500 border border-white/5"}`}>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span>🔊</span>
                <span>Music Lounge</span>
              </div>
              <span className={`w-2 h-2 rounded-full ${hasVoiceUsers ? "bg-green-500 animate-pulse" : "bg-rose-500"}`} />
            </div>
          </div>

          {/* Voice Simulator Controller */}
          <div className="bg-[#1e1f22]/50 rounded-xl p-3.5 border border-white/5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#dbdee1]">حالة الفويس (البوت)</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={hasVoiceUsers} 
                  onChange={(e) => handleVoiceUsersToggle(e.target.checked)} 
                  className="sr-only peer" 
                />
                <div className="w-9 h-5 bg-[#4e5058] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>

            <div className="border-t border-white/5 pt-2.5 space-y-2.5">
              <div className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider">لوحة محاكاة الأعضاء (للتحكم)</div>
              
              {/* Selector for who is the current interacting user */}
              <div className="space-y-1">
                <label className="block text-[10px] text-slate-300">العضو المتفاعل حالياً:</label>
                <select 
                  value={currentSimUser}
                  onChange={(e) => {
                    setCurrentSimUser(e.target.value);
                    addSimulatedMessage(`👤 تم تبديل العضو المتفاعل إلى: ${e.target.value}`, "info");
                  }}
                  className="w-full bg-[#1e1f22] border border-[#383a40] rounded px-2 py-1 text-xs text-[#dbdee1] focus:outline-none"
                >
                  <option value="أحمد (احمد NTL)">أحمد (أحمد NTL - مالك)</option>
                  <option value="يوسف">يوسف (عضو)</option>
                  <option value="علي">علي (عضو)</option>
                </select>
              </div>

              {/* Toggle for whether the current interacting user is inside/outside voice */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-slate-300">تواجد العضو بالفويس:</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={userInVoice} 
                    onChange={(e) => {
                      setUserInVoice(e.target.checked);
                      addSimulatedMessage(
                        e.target.checked 
                          ? `🔊 دخل العضو (${currentSimUser}) الروم الصوتي.` 
                          : `🚪 خرج العضو (${currentSimUser}) خارج الروم الصوتي ولا يمكنه التحكم.`, 
                        "voice"
                      );
                    }} 
                    className="sr-only peer" 
                  />
                  <div className="w-9 h-5 bg-[#4e5058] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                </label>
              </div>
            </div>

            <p className="text-[10px] text-[#949ba4] leading-relaxed border-t border-white/5 pt-2">
              تتيح لك هذه اللوحة محاكاة صلاحيات الإيقاف المؤقت (فقط لمن طلب الأغنية) ومنع التحكم من خارج الفويس.
            </p>
          </div>

          {/* Separation Architecture Info */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase font-bold text-[#949ba4] px-1 tracking-wider">هيكلية النظام المنفصل</div>
            
            <div className="bg-[#1e1f22]/30 p-2.5 rounded-lg border border-white/5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-blue-400">music.js</span>
                <span className="text-[8px] bg-blue-500/10 text-blue-300 px-1.5 py-0.2 rounded border border-blue-500/20">منفصل</span>
              </div>
              <p className="text-[10px] text-[#949ba4] leading-normal">
                مشغل لافالينك، مهام الاستماع للأغاني، حدث الخروج التلقائي، ودالة تصميم إيمبد التشغيل وإيمبد الانتظار.
              </p>
            </div>

            <div className="bg-[#1e1f22]/30 p-2.5 rounded-lg border border-white/5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-purple-400">index.js</span>
                <span className="text-[8px] bg-purple-500/10 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/20">أساسي</span>
              </div>
              <p className="text-[10px] text-[#949ba4] leading-normal">
                الملف الرئيسي لتشغيل البوت، حماية الصلاحيات، نظام التكتات، ومقاومة التخريب (Anti-Abuse).
              </p>
            </div>
          </div>

          {/* Mini Live Terminal logs */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase font-bold text-[#949ba4] px-1 tracking-wider">سجل أحداث لافالينك المباشر</div>
            <div className="bg-[#1e1f22] rounded-lg p-2 font-mono text-[9px] leading-relaxed h-28 overflow-y-auto border border-black/10 text-slate-300 space-y-1 select-text">
              {simulatedMessages.length === 0 ? (
                <span className="text-gray-600 block text-center py-4">في انتظار العمليات...</span>
              ) : (
                simulatedMessages.map((msg) => (
                  <div key={msg.id} className="border-b border-white/5 pb-0.5 last:border-0">
                    <span className="text-blue-400 ml-1 font-bold">[{msg.type.toUpperCase()}]</span>
                    <span>{msg.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Footer info inside sidebar */}
        <div className="p-3 bg-[#232428] border-t border-black/20 space-y-2 shrink-0">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#949ba4]">اتصال Lavalink:</span>
            <span className="text-green-400 font-bold">متصل بالروم</span>
          </div>
          <div className="text-[10px] text-[#f23f43] bg-[#f23f43]/10 p-1.5 rounded border border-[#f23f43]/20 text-center font-mono">
            Anti-Abuse: 1.5s Cooldown Active
          </div>
        </div>
      </div>

      {/* 3. Main Area: Chat Room with Embeds, Controls, Logs and Inputs */}
      <div className="flex-1 bg-[#313338] flex flex-col min-w-0">
        
        {/* Chat Room Top Bar */}
        <div className="h-12 border-b border-black/20 flex items-center justify-between px-4 shadow-sm shrink-0 bg-[#313338]">
          <div className="flex items-center gap-2">
            <span className="text-[#949ba4] text-xl font-light">#</span>
            <span className="font-bold text-white text-sm">روم-الموسيقى والتحكم</span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border ${
              botStatus?.tokenConfigured 
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${botStatus?.tokenConfigured ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-bounce"}`} />
              <span>{botStatus?.tokenConfigured ? "البوت متصل بالديسكورد" : "في انتظار توكن البوت"}</span>
            </div>

            {isSpamBlocked && (
              <span className="text-[11px] bg-rose-500/10 text-rose-400 px-2.5 py-1 rounded-full border border-rose-500/20 font-mono animate-bounce flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>حماية التباطؤ {cooldownRemaining.toFixed(1)}s</span>
              </span>
            )}
          </div>
        </div>

        {/* Chat Room Message Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          
          {/* Discord Room Welcome Header */}
          <div className="border-b border-white/5 pb-4">
            <div className="w-14 h-14 rounded-full bg-[#35373c] flex items-center justify-center text-white text-3xl font-light mb-3 select-none">
              #
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">مرحباً بك في روم الأغاني!</h2>
            <p className="text-xs text-[#949ba4]">هذه هي بداية قناة #روم-الموسيقى والتحكم الخاصة بالبوت NTL Music.</p>
          </div>

          {/* Discord Bot Message Block */}
          <div className="flex items-start gap-4">
            
            {/* Bot Avatar */}
            <div className="w-10 h-10 rounded-full bg-[#5865f2] text-white flex items-center justify-center font-bold text-xs shrink-0 select-none shadow-md overflow-hidden">
              <img 
                src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=80&auto=format&fit=crop&q=80" 
                alt="Bot Avatar"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Message Core */}
            <div className="flex-1 space-y-4 min-w-0 text-right">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#f2f3f5] text-sm hover:underline cursor-pointer">NTL BOT</span>
                <span className="bg-[#5865f2] text-[10px] text-white font-bold px-1 rounded flex items-center gap-0.5 select-none uppercase tracking-wide">
                  ✔ تطبيق
                </span>
                <span className="text-[10px] text-gray-400 font-mono">Today at 2:20 PM</span>
              </div>

              {/* Empty state when no track is active */}
              {!currentTrack ? (
                <div className="bg-[#2b2d31] border-r-4 border-slate-600 rounded-lg p-6 text-gray-400 text-center flex flex-col items-center justify-center gap-3 max-w-[580px]">
                  <ListMusic className="w-12 h-12 text-slate-500" />
                  <p className="font-semibold text-slate-300">لا توجد أغانٍ قيد التشغيل حالياً</p>
                  <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                    يرجى إضافة أغنية من شريط الإرسال بالأسفل لتفعيل المعاينة التفاعلية المزدوجة للاغنية وقائمة الانتظار.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 max-w-[580px]">
                  
                  {/* COMPONENTS V2: Combined Container (Light Green Border) */}
                  <div className="bg-[#2b2d31] rounded-lg border-r-4 border-[#57F287] p-5 shadow-xl relative overflow-hidden flex flex-col gap-4 text-right">
                    
                    {/* Header V2 badge representation */}
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="flex items-center gap-1.5 text-[10px] text-[#57F287] font-mono font-bold bg-[#57F287]/10 px-2.5 py-1 rounded border border-[#57F287]/20">
                        <span>● Components V2 Active</span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono">accent_color: 0x57F287</span>
                    </div>

                    {/* 1. TEXT DISPLAY COMPONENT */}
                    <div className="bg-[#1e1f22]/40 rounded p-3 border border-white/5 space-y-1">
                      <div className="text-[11px] font-mono text-[#949ba4] font-bold uppercase tracking-wider mb-1">Text Display Component</div>
                      <h4 className="text-base font-bold text-white leading-snug flex items-center flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1 bg-[#1db954]/10 text-[#1db954] px-1.5 py-0.5 rounded border border-[#1db954]/20 text-xs">
                          <span className="animate-pulse">🟢</span> Spotify
                        </span>
                        <span className="text-[#57F287] hover:underline cursor-pointer font-bold select-text">
                          **&lt;:Spotify:1520459707691565096&gt; | {currentTrack.title}**
                        </span>
                      </h4>
                      <p className="text-[11px] text-[#949ba4] leading-normal">
                        This text is inside a Text Display component! You can use **any __markdown__** available inside this component too.
                      </p>
                    </div>

                    {/* SEPARATOR COMPONENT */}
                    <div className="border-t border-[#4e5058]/40 my-0.5" title="Separator Component" />

                    {/* 2. SECTION COMPONENT (with content & thumbnail accessory) */}
                    <div className="flex justify-between items-start gap-4 bg-[#1e1f22]/20 p-3 rounded border border-white/5">
                      <div className="flex-1 space-y-3 min-w-0">
                        <div className="text-[11px] font-mono text-[#949ba4] font-bold uppercase tracking-wider">Section Component</div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <p className="text-slate-300 flex items-center gap-1.5">
                            <span className="text-[#949ba4]">بواسطة المؤدي:</span>
                            <span className="text-slate-100 font-semibold truncate">{currentTrack.author}</span>
                          </p>
                          <p className="text-slate-300 flex items-center gap-1.5">
                            <span className="text-[#949ba4]">الطلب بواسطة:</span>
                            <span className="bg-[#5865f2]/10 text-[#5865f2] border border-[#5865f2]/20 px-1.5 py-0.2 rounded font-semibold truncate">
                              @{currentTrack.requester}
                            </span>
                          </p>
                        </div>

                        {/* Dynamic Playback Ticker progress bar */}
                        <div className="space-y-1 pt-1">
                          <div className="flex justify-between text-[11px] font-mono text-[#949ba4]">
                            <span>{formatTime(trackSeconds)}</span>
                            <span>{formatTime(trackDuration)}</span>
                          </div>
                          <div className="h-1.5 w-full bg-[#4e5058] rounded-full relative">
                            <div 
                              className="absolute top-0 right-0 h-full bg-[#57F287] rounded-full transition-all duration-300"
                              style={{ width: `${(trackSeconds / trackDuration) * 100}%` }}
                            />
                            <div 
                              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow border border-gray-400 transition-all duration-300"
                              style={{ right: `calc(${(trackSeconds / trackDuration) * 100}% - 6px)` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section Thumbnail Accessory */}
                      {currentTrack.thumbnail && (
                        <div className="w-20 h-20 bg-black/40 rounded flex flex-col items-center justify-center border border-white/10 shrink-0 self-center relative group">
                          <img 
                            src={currentTrack.thumbnail} 
                            alt="track thumbnail" 
                            className="w-full h-full object-cover rounded"
                            referrerPolicy="no-referrer"
                          />
                          <span className="absolute bottom-1 right-1 bg-black/70 text-[8px] text-[#949ba4] px-1 rounded font-mono">Accessory</span>
                        </div>
                      )}
                    </div>

                    {/* SEPARATOR COMPONENT */}
                    <div className="border-t border-[#4e5058]/40 my-0.5" title="Separator Component" />

                    {/* 3. ACTION ROW COMPONENTS (Control Buttons) */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-mono text-[#949ba4] font-bold uppercase tracking-wider">Action Row Components (Buttons)</div>
                      
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handlePrev}
                          disabled={history.length === 0}
                          className="bg-[#4e5058] hover:bg-[#6d6f78] disabled:bg-[#35363c] disabled:text-[#72767d] text-white px-3.5 py-1.5 rounded text-xs font-semibold transition flex items-center justify-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <SkipBack className="w-3.5 h-3.5 fill-white shrink-0" />
                          <span>السابق</span>
                        </button>

                        {/* Restricted pause button based on requester */}
                        <button
                          onClick={handleTogglePlay}
                          className={`${
                            isPlaying 
                              ? "bg-[#4e5058] hover:bg-[#6d6f78]" 
                              : "bg-[#248046] hover:bg-[#1a6535]"
                          } text-white px-4 py-1.5 rounded text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer relative overflow-hidden`}
                          title={currentTrack.requester !== currentSimUser ? `مقفل! متاح فقط لـ @${currentTrack.requester}` : "اضغط للإيقاف المؤقت أو التشغيل"}
                        >
                          {currentTrack.requester !== currentSimUser && (
                            <span className="absolute top-0 left-0 bg-red-500/20 text-red-300 text-[8px] px-1 font-mono rounded-br">🔒 مقيد</span>
                          )}
                          {isPlaying ? (
                            <>
                              <Pause className="w-3.5 h-3.5 fill-white shrink-0" />
                              <span>إيقاف مؤقت</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-white shrink-0" />
                              <span>تشغيل</span>
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleNext}
                          className="bg-[#4e5058] hover:bg-[#6d6f78] text-white px-3.5 py-1.5 rounded text-xs font-semibold transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <SkipForward className="w-3.5 h-3.5 fill-white shrink-0" />
                          <span>التالي</span>
                        </button>
                      </div>
                    </div>

                    {/* SEPARATOR COMPONENT */}
                    <div className="border-t border-[#4e5058]/40 my-0.5" title="Separator Component" />

                    {/* 4. SELECT MENU COMPONENT (UserSelectMenuBuilder / Custom loop & disconnect selector) */}
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] font-mono text-[#949ba4] font-bold uppercase tracking-wider">Action Row Components (Select Menu)</div>
                      
                      <div className="relative max-w-[340px]">
                        <div
                          onClick={() => setIsSelectMenuOpen(!isSelectMenuOpen)}
                          className="w-full bg-[#1e1f22] border border-[#3f4147] hover:bg-[#383a40] text-right text-xs text-slate-200 px-3 py-2.5 rounded flex items-center justify-between transition cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-2">
                            <span className="opacity-80">🔽</span>
                            <span>اختر نمط التشغيل أو الخروج...</span>
                          </div>
                          {isLooping ? (
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">🔁 repetition active</span>
                          ) : (
                            <span className="text-[10px] opacity-40">Select users</span>
                          )}
                        </div>
                        
                        {isSelectMenuOpen && (
                          <div className="absolute right-0 left-0 mt-1 bg-[#1e1f22] border border-black/60 rounded shadow-2xl z-20 overflow-hidden text-right animate-fade-in divide-y divide-white/5">
                            {/* Option 1: repetition loop */}
                            <div 
                              onClick={() => {
                                handleToggleLoop();
                                setIsSelectMenuOpen(false);
                              }}
                              className="p-3 flex items-center justify-between hover:bg-[#4e5058]/40 transition-colors cursor-pointer"
                            >
                              <div className="flex flex-col text-right">
                                <span className="font-semibold flex items-center gap-1.5 text-white text-xs">
                                  <span className="text-[#5865f2]">🔁</span>
                                  <span>repetition</span>
                                </span>
                                <span className="text-[10px] text-[#949ba4] mt-0.5">تكرار الأغنية الحالية بشكل لا نهائي تلقائياً</span>
                              </div>
                              {isLooping ? (
                                <span className="text-emerald-400 font-bold text-xs">نشط ✅</span>
                              ) : (
                                <span className="text-xs text-[#949ba4]">مغلق</span>
                              )}
                            </div>

                            {/* Option 2: disconnect bot */}
                            <div 
                              onClick={() => {
                                handleDisconnect();
                                setIsSelectMenuOpen(false);
                              }}
                              className="p-3 flex items-center justify-between hover:bg-[#4e5058]/40 transition-colors cursor-pointer text-rose-400 hover:text-rose-300"
                            >
                              <div className="flex flex-col text-right">
                                <span className="font-semibold flex items-center gap-1.5 text-xs">
                                  <span>🚪</span>
                                  <span>&lt;:Disconnect:1520462158213681313&gt; disconnect</span>
                                </span>
                                <span className="text-[10px] text-[#949ba4] mt-0.5">مغادرة الروم الصوتي وتصفير قوائم الانتظار بالكامل</span>
                              </div>
                              <span className="text-[10px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20">خروج</span>
                            </div>
                          </div>
                        )}
                        
                        {/* Legend explanatory text */}
                        <p className="text-[10px] text-[#949ba4] mt-1.5 leading-normal">
                          مفتاح التكرار <code className="text-indigo-300">&lt;:repetition:1516799992432558121&gt;</code> لتكرار الأغنية. ومفتاح الخروج <code className="text-rose-300">&lt;:Disconnect:1520462158213681313&gt;</code> لمغادرة البوت.
                        </p>
                      </div>
                    </div>

                  </div>

                  {/* EMBED 2: Queue List Embed (Separate - Green Discord Border) */}
                  {queue.length > 0 && (
                    <div className="bg-[#2b2d31] rounded-lg border-r-4 border-[#248046] p-4 shadow-lg relative overflow-hidden flex justify-between gap-4 animate-fade-in">
                      <div className="space-y-3 flex-1 min-w-0">
                        <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-[#949ba4] uppercase font-mono">
                          <span>قائمة الانتظار الحالية (Upcoming Queue)</span>
                          <span className="text-rose-400">الحد الأقصى: 5</span>
                        </div>
                        
                        <ol className="space-y-2.5 text-xs text-slate-200">
                          {queue.map((track, index) => (
                            <li key={track.id} className="flex items-center justify-between gap-2 border-b border-[#334155]/20 pb-2 last:border-0 last:pb-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[#949ba4] font-mono font-bold shrink-0">{index + 1}.</span>
                                <div className="min-w-0 text-right">
                                  <p className="font-semibold text-white truncate">{track.title}</p>
                                  <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                                    <span>المغني: {track.author}</span>
                                    <span>•</span>
                                    <span className="text-indigo-400 bg-indigo-500/5 px-1 rounded">@{track.requester}</span>
                                  </p>
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  if (!checkUserVoiceStatus()) return;
                                  setQueue((prev) => prev.filter((t) => t.id !== track.id));
                                  addSimulatedMessage(`🗑️ تم إزالة أغنية من قائمة الانتظار: ${track.title}`, "info");
                                }}
                                className="text-gray-400 hover:text-rose-400 p-1 rounded hover:bg-[#383a40] transition cursor-pointer shrink-0"
                                title="حذف من قائمة الانتظار"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          ))}
                        </ol>

                        <div className="mt-3 text-[10px] text-center text-[#949ba4] italic">
                          {`تم إضافة ${queue.length} من أصل 5 أغاني كحد أقصى في قائمة الانتظار.`}
                        </div>
                      </div>

                      {/* Preview of next thumbnail in queue */}
                      {queue[0]?.thumbnail && (
                        <div className="w-16 h-16 rounded overflow-hidden shrink-0 shadow-inner border border-white/5 self-center">
                          <img 
                            src={queue[0].thumbnail} 
                            alt="next track thumbnail" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}

            </div>
          </div>

          {/* Interactive Chat Log System Advisor Feed */}
          {simulatedMessages.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-white/5">
              <h4 className="text-[10px] font-bold tracking-wider text-[#949ba4] uppercase font-mono">سجل أحداث المحاكاة التفاعلية</h4>
              <div className="space-y-3">
                {simulatedMessages.slice(0, 3).map((msg) => {
                  let typeLabel = "النظام";
                  let icon = "⚙️";
                  let color = "text-[#949ba4]";
                  if (msg.type === "success") { icon = "✅"; color = "text-emerald-400"; typeLabel = "تشغيل"; }
                  if (msg.type === "warning") { icon = "⚠️"; color = "text-amber-400"; typeLabel = "حماية"; }
                  if (msg.type === "error") { icon = "❌"; color = "text-rose-400"; typeLabel = "فشل"; }
                  if (msg.type === "voice") { icon = "🚪"; color = "text-indigo-400"; typeLabel = "فويس"; }

                  return (
                    <div key={msg.id} className="flex items-start gap-4 p-2 rounded bg-[#2e3035]/20 border border-white/5">
                      <div className="w-9 h-9 rounded-full bg-[#35373c] flex items-center justify-center text-sm shrink-0">
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0 text-right">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-100 text-xs">إشعار {typeLabel}</span>
                          <span className="bg-[#4e5058] text-[8px] text-gray-200 px-1 py-0.2 rounded font-mono">LAVALINK</span>
                          <span className="text-[9px] text-[#949ba4] font-mono">Live</span>
                        </div>
                        <p className={`text-xs mt-1 leading-relaxed ${color}`}>{msg.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Checklist Summary (styled beautifully as a pinned channel policy/guild rules box) */}
          <div className="bg-[#2b2d31]/50 rounded-xl border border-white/5 p-4 max-w-[580px] text-right">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2 border-b border-white/5 pb-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>مراجعة تلبية شروط الطلب البرمجي</span>
            </h3>

            <ul className="space-y-2 text-xs text-gray-300 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <div>
                  <strong className="text-slate-100 ml-1">فصل ملف الأغاني بالكامل:</strong> تم كتابة نظام التشغيل في ملف <code className="text-blue-300 font-mono bg-[#1e1f22] px-1 py-0.5 rounded font-bold">music.js</code> بشكل مستقل تماماً عن الكود العام في <code className="text-blue-300 font-mono bg-[#1e1f22] px-1 py-0.5 rounded font-bold">index.js</code>.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <div>
                  <strong className="text-slate-100 ml-1">فصل إيمبد الانتظار:</strong> عند تشغيل أغنية وإضافتها للانتظار، يتم توليد إيمبد منفصل تماماً (Double-Embed) تحت الإيمبد الحالي والأزرار تحتهم، تماماً كما في الصورة.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <div>
                  <strong className="text-slate-100 ml-1">قائمة تكرار تلقائية (Repetition Select Menu):</strong> تم إضافة زر تكرار مخصص تحت الأزرار بـ Select Menu يحمل الايموجي {"<:repetition:1516799992432558121>"} والاسم repetition لتفعيل وإيقاف الإعادة التلقائية اللانهائية.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <div>
                  <strong className="text-slate-100 ml-1">الخروج التلقائي عند فراغ الروم:</strong> تم إضافة مستمع للحدث <code className="text-indigo-300 font-mono bg-[#1e1f22] px-1 py-0.5 rounded font-bold">voiceStateUpdate</code> بحيث لو غادر جميع الأعضاء الروم، يخرج البوت تلقائياً لحفظ موارد النظام.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <div>
                  <strong className="text-slate-100 ml-1">حماية ضد العبث السريع (Anti-Abuse Rate Limit):</strong> البوت يحمي نفسه بـ Cooldown يبلغ 1.5 ثانية بين كل تفاعل لتفادي الأعطال وتوقف البوت عن الاستجابة.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <div>
                  <strong className="text-slate-100 ml-1">تحديد حد الأغاني المسموح به:</strong> قائمة الانتظار تقتصر على حد أقصى يبلغ 5 أغاني لمنع تكدس الذاكرة.
                </div>
              </li>
            </ul>
          </div>

        </div>

        {/* Discord command text input bar */}
        <div className="px-4 py-4 md:py-6 bg-[#313338] border-t border-black/10 shrink-0">
          <form onSubmit={handleAddSong} className="max-w-[700px] mx-auto bg-[#383a40] rounded-xl p-2 md:p-3 flex flex-col md:flex-row items-center gap-3">
            <div className="w-8 h-8 bg-[#4e5058] rounded-full flex items-center justify-center text-white text-lg font-bold select-none shrink-0">
              +
            </div>
            
            <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 gap-2 text-right">
              <input 
                type="text" 
                value={inputTitle}
                onChange={(e) => setInputTitle(e.target.value)}
                placeholder={hasVoiceUsers ? "اكتب اسم الأغنية هنا أو رابط التشغيل..." : "❌ يجب الانضمام للفويس أولاً"}
                className="w-full bg-transparent text-sm text-[#dbdee1] placeholder-[#949ba4] focus:outline-none py-1.5 px-2 text-right"
                disabled={!hasVoiceUsers}
              />
              <input 
                type="text" 
                value={inputAuthor}
                onChange={(e) => setInputAuthor(e.target.value)}
                placeholder={hasVoiceUsers ? "اسم المؤدي / الفنان (اختياري)..." : "❌ فويس شانيل غير متصل"}
                className="w-full bg-transparent text-sm text-[#dbdee1] placeholder-[#949ba4] focus:outline-none py-1.5 px-2 border-r border-[#4e5058]/40 text-right md:pr-4 pr-2"
                disabled={!hasVoiceUsers}
              />
            </div>

            <button
              type="submit"
              disabled={!hasVoiceUsers || !inputTitle.trim()}
              className="px-4 py-1.5 bg-[#5865f2] hover:bg-[#4752c4] disabled:bg-[#35363c] disabled:text-[#72767d] text-white rounded text-xs font-bold transition shrink-0 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إرسال الطلب</span>
            </button>
          </form>
          <div className="max-w-[700px] mx-auto mt-1 px-4 text-[10px] text-[#949ba4] text-right">
            اكتب اسم الأغنية التي تود الاستماع إليها ثم اضغط على زر "إرسال الطلب" أو مفتاح Enter لإضافتها لقائمة لافالينك.
          </div>
        </div>

      </div>

    </div>
  );
}
