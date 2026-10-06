/**
 * ReleaseNotesModal.tsx — Changelog & Version Details Modal.
 * Displays release history, feature tags, and updates.
 */
import { useEffect } from "react";
import { useApp } from "../context/AppContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ReleaseItem {
  version: string;
  date: string;
  isLatest?: boolean;
  tagline: { tr: string; en: string };
  features: Array<{
    icon: string;
    tag: { tr: string; en: string };
    tagType: "new" | "security" | "improvement" | "fix";
    title: { tr: string; en: string };
    desc: { tr: string; en: string };
  }>;
}

export function ReleaseNotesModal({ isOpen, onClose }: Props) {
  const { lang } = useApp();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isTr = lang === "tr";

  const releases: ReleaseItem[] = [
    {
      version: "v0.3.3",
      date: isTr ? "6 Ekim 2026" : "October 6, 2026",
      isLatest: true,
      tagline: {
        tr: "⚡ Yüksek Performanslı Pano, Çoklu Monitör Ekran Alıntısı & Parametrik Akış",
        en: "⚡ High-Performance Clipboard, Multi-Monitor Screenshot & Parametric Flow",
      },
      features: [
        {
          icon: "⚡",
          tag: { tr: "Performans", en: "Performance" },
          tagType: "improvement",
          title: {
            tr: "Ultra Hızlı Pano Geçmişi & Akıllı Küçük Resim (Thumbnail) Önbelleği",
            en: "Ultra-Fast Clipboard History & Smart Thumbnail Caching",
          },
          desc: {
            tr: "Pano geçmişinde yüksek çözünürlüklü görseller için anında 120x80 hafif önbellek küçük resimleri üretilerek IPC veri yükü %99 oranında düşürüldü. SQLite bellek optimizasyonları ve CSS content-visibility render hızlandırması ile tüm bilgisayarlarda sıfır gecikmeli akıcı deneyim sağlandı.",
            en: "Over 99% IPC payload reduction using instant 120x80 thumbnail generation for clipboard images. SQLite memory PRAGMAs and CSS content-visibility render skipping ensure zero-latency fluid browsing on all client machines.",
          },
        },
        {
          icon: "↕️",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Tam Ekran Pano Sıralama Yönü (Parametrik)",
            en: "Parametric Fullscreen Clipboard Flow (Vertical & Horizontal)",
          },
          desc: {
            tr: "Ayarlar > Pano sekmesinden 'Yukarıdan Aşağıya (Dikey Akış)' veya 'Soldan Sağa (Yatay Akış)' modu seçilebilir. Grid yapısı korunarak kartlar sütunlar boyunca doğal akışta listelenir.",
            en: "Choose between 'Top to Bottom (Vertical Flow)' or 'Left to Right (Horizontal Flow)' in Settings > Clipboard. Grid structure is preserved with seamless column-wise reading.",
          },
        },
        {
          icon: "📌",
          tag: { tr: "İyileştirme", en: "Improvement" },
          tagType: "improvement",
          title: {
            tr: "Tam Ekran Önizleme Penceresi Sağda Sabitleme",
            en: "Fixed Right-Docked Preview Popover in Fullscreen",
          },
          desc: {
            tr: "Tam ekran pano modunda içerik detay penceresi artık asla sağa-sola zıplamaz; ekranın sağ tarafında kararlı ve sabit bir şekilde konumlanır.",
            en: "In fullscreen mode, the content preview popover is strictly docked to the right edge and never bounces back and forth.",
          },
        },
        {
          icon: "🖥️",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Çoklu Monitör Ekran Alıntısı (Parametrik)",
            en: "Parametric Multi-Monitor Screenshot Capture",
          },
          desc: {
            tr: "Ayarlar > Ekran Alıntısı sekmesinden tek tıkla 'Aktif Monitör' veya 'Tüm Monitörler (Birleşik Sanal Masaüstü)' modu seçilebilir. Çoklu monitörlerde tüm ekranlar tek bir geniş kanvasta kırpılabilir.",
            en: "Toggle between active monitor or unified virtual multi-display capture in Settings > Screenshot.",
          },
        },
        {
          icon: "✓",
          tag: { tr: "Yeni Kısayol", en: "New Shortcut" },
          tagType: "new",
          title: {
            tr: "Aktif Görevi Tamamlama Kısayolu (Ctrl + Shift + D)",
            en: "Complete Active Task Shortcut (Ctrl + Shift + D)",
          },
          desc: {
            tr: "Çalışmakta olan aktif görevi veya son görevi anında tamamlandıya çeker, sayacı durdurur, yüzen widget'ı gizler ve Windows bildirimi gösterir.",
            en: "Instantly mark running task as completed, stop focus timer, and hide floating widget with one global hotkey.",
          },
        },
        {
          icon: "⌨️",
          tag: { tr: "Düzeltme", en: "Fix" },
          tagType: "fix",
          title: {
            tr: "Shift + Print Screen Kısayol Desteği & Windows Düzeltmesi",
            en: "Shift + Print Screen & Standalone PrintScreen Support",
          },
          desc: {
            tr: "Windows Chromium'un PrintScreen tuşunda keydown olayını yutma sorunu giderildi. Artık Shift + PrintScreen veya PrintScreen kısayolları doğrudan ayarlanabilir.",
            en: "Fixed Windows Chromium issue swallowing PrintScreen keydown; Shift + PrintScreen and PrintScreen can now be cleanly registered.",
          },
        },
        {
          icon: "🧭",
          tag: { tr: "Akıllı Arayüz", en: "Smart UI" },
          tagType: "improvement",
          title: {
            tr: "Popup Modunda Akıllı Dinamik Önizleme",
            en: "Smart Dynamic Preview for Compact Popup Mode",
          },
          desc: {
            tr: "Kompakt açılır pencere ekranın sağ kenarına yakın açıldığında detay popover'ı otomatik sol tarafa taşınarak ekran dışına taşması engellenir.",
            en: "In compact popup mode, popover automatically switches to the left side when close to the screen's right edge.",
          },
        },
        {
          icon: "🛡️",
          tag: { tr: "Düzeltme", en: "Fix" },
          tagType: "fix",
          title: {
            tr: "Tekrarlayan (Duplicate) Pano Kayıtlarının Engellenmesi",
            en: "Duplicate Clipboard History Prevention",
          },
          desc: {
            tr: "Aynı metin veya öğe kopyalandığında listede çift kayıt oluşturulması engellendi, mevcut kayıt en başa taşınacak şekilde optimize edildi.",
            en: "Prevents duplicate items when copying same text repeatedly, updating existing entry timestamp instead.",
          },
        },
        {
          icon: "🔢",
          tag: { tr: "Düzeltme", en: "Fix" },
          tagType: "fix",
          title: {
            tr: "Ayarlar Paneli Kısayol Sayacı Rozeti (7 Adet)",
            en: "Settings Hotkeys Badge Count Corrected (7 Items)",
          },
          desc: {
            tr: "Ayarlar menüsündeki Kısayol Tuşları rozet sayısı yeni eklenen Görevi Tamamla kısayolu ile uyumlu olarak 7'ye güncellendi.",
            en: "Updated hotkeys tab badge count to accurately reflect all 7 configurable global shortcuts.",
          },
        },
      ],
    },
    {
      version: "v0.3.0",
      date: isTr ? "1 Ekim 2026" : "October 1, 2026",
      tagline: {
        tr: "🛡️ Acil Durum Kurtarma, Görev Sayacı, Canlı Otomatik Güncelleme ve Dahili Kılavuz",
        en: "🛡️ Emergency Recovery, Task Tracker, Live Auto-Updater & In-App Guide",
      },
      features: [
        {
          icon: "🛡️",
          tag: { tr: "Yeni Güvenlik", en: "New Security" },
          tagType: "security",
          title: {
            tr: "24 Haneli Acil Durum Kurtarma Anahtarı (Emergency Kit)",
            en: "24-Character Emergency Recovery Key (Emergency Kit)",
          },
          desc: {
            tr: "Kasa oluşturulduğunda kullanıcıya özel 24 haneli kriptografik kurtarma anahtarı (PCYF-XXXX-...) verilir. Ana şifre unutulsa bile sıfır veri kaybı ile kasa kurtarılabilir.",
            en: "Generates a 24-character cryptographic recovery key. Recover your entire vault with zero data loss if master password is forgotten.",
          },
        },
        {
          icon: "💡",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Parola İpucu & Kilit Ekranı Entegrasyonu",
            en: "Password Hint & Lock Screen Integration",
          },
          desc: {
            tr: "Kurulumda veya ayarlarda isteğe bağlı parola ipucu tanımlayabilme; kilit ekranında '💡 İpucunu Göster' düğmesi ve hatalı denemelerde otomatik hatırlatma.",
            en: "Optional password hint support; reveal button on lock screen with auto-reminder on repeated failed attempts.",
          },
        },
        {
          icon: "🔄",
          tag: { tr: "Güvenlik", en: "Security" },
          tagType: "security",
          title: {
            tr: "Güvenli Kasa Sıfırlama (Clean Vault Reset)",
            en: "Clean Vault Reset",
          },
          desc: {
            tr: "Hem şifre hem kurtarma anahtarı unutulursa, görevler ve pano verileri korunarak yalnızca şifrelenmiş kasayı temiz sıfırlama seçeneği.",
            en: "Wipe lost credentials cleanly without deleting tasks, worklogs, or clipboard history.",
          },
        },
        {
          icon: "⚡",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Hızlı Görev Oluşturucu Popup (Ctrl + Shift + N)",
            en: "Quick Task Creator Popup (Ctrl + Shift + N)",
          },
          desc: {
            tr: "Herhangi bir uygulamadayken tek kısayolla mini görev penceresi açıp görevi yazıp Enter'a basınca anında görev açılır ve sayacı başlar.",
            en: "Global popup to create a task in 3 seconds; pressing Enter starts focus timer immediately.",
          },
        },
        {
          icon: "🖥️",
          tag: { tr: "İyileştirme", en: "Improvement" },
          tagType: "improvement",
          title: {
            tr: "Yönetici Penceresi %30 Genişletildi (1300×830)",
            en: "Manager Window Enlarged by 30% (1300×830)",
          },
          desc: {
            tr: "Tüm ekran bileşenleri, kartlar ve formlar için daha ferah ve modern bir çalışma alanı sağlandı.",
            en: "Spacious layout preventing clipping across credentials, checklists, and notes.",
          },
        },
        {
          icon: "🧭",
          tag: { tr: "Arayüz", en: "UI / UX" },
          tagType: "improvement",
          title: {
            tr: "Sekmeli Profesyonel Ayarlar Merkezi",
            en: "Modern Tabbed Settings Hub",
          },
          desc: {
            tr: "Görünüm, Kısayollar, Pano, Ekran Alıntısı, Güvenlik ve Güncellemeler kategorilerine ayrılmış sezgisel ayar paneli.",
            en: "Organized two-column sidebar navigation across General, Hotkeys, Clipboard, Screenshot, Security, and Updates.",
          },
        },
        {
          icon: "⏱️",
          tag: { tr: "İyileştirme", en: "Improvement" },
          tagType: "improvement",
          title: {
            tr: "Yüzen Sayaç Çift Tıklama ile Göreve Odaklanma",
            en: "Double-Click Floating Timer to Open Task",
          },
          desc: {
            tr: "Masaüstü yüzen sayaç widget'ına çift tıklandığında Yönetici penceresi doğrudan o görevin detaylarıyla açılır.",
            en: "Double-clicking the floating timer widget now jumps straight into the task details.",
          },
        },
        {
          icon: "📖",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Dahili Kullanıcı Kılavuzu & Yardım Merkezi",
            en: "In-App User Guide & Documentation",
          },
          desc: {
            tr: "Uygulama içerisinden doğrudan erişilebilen kılavuz, arama motoru ve sıkça sorulan sorular.",
            en: "Interactive documentation, troubleshooting guides, and searchable FAQ directly inside the app.",
          },
        },
      ],
    },
    {
      version: "v0.2.1",
      date: isTr ? "30 Eylül 2026" : "September 30, 2026",
      tagline: {
        tr: "🎯 Günlük Görev Planlayıcı, Efor Takibi ve Yüzen Sayaç",
        en: "🎯 Task Planner, Effort Worklogs & Floating Desktop Timer",
      },
      features: [
        {
          icon: "⏱️",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Yüzen Masaüstü Mini Odak Sayacı (Ctrl + Shift + T)",
            en: "Desktop Floating Focus Timer (Ctrl + Shift + T)",
          },
          desc: {
            tr: "Ekranda sürüklenebilir, canlı saat ve duraklatma kontrollerine sahip yarı saydam masaüstü widget'ı.",
            en: "Draggable, always-on-top translucent widget with live digital clock and one-click controls.",
          },
        },
        {
          icon: "🎯",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Görev Planlayıcı & Çalışma Logları (Ctrl + Shift + P)",
            en: "Task Planner & Worklogs (Ctrl + Shift + P)",
          },
          desc: {
            tr: "Öncelik etiketleri, alt adım kontrol listeleri, zengin notlar ve atomik SQLite efor kayıtları.",
            en: "Priority badges, checklists, technical notes canvas, and atomic SQLite time tracking.",
          },
        },
        {
          icon: "🧠",
          tag: { tr: "Akıllı Algılama", en: "Smart Engine" },
          tagType: "new",
          title: {
            tr: "Ekran Kilidi (Win+L) ve 60sn Boşta Kalma Algılama",
            en: "Workstation Lock (Win+L) & 60s Idle Auto-Pause",
          },
          desc: {
            tr: "Kullanıcı bilgisayarı kilitlediğinde veya masadan kalktığında sayacın otomatik duraklatılması ve dönüşte devam etmesi.",
            en: "Automatically detects screen lock or 60s inactivity, pauses timer, and auto-resumes on return.",
          },
        },
        {
          icon: "📋",
          tag: { tr: "Raporlama", en: "Reporting" },
          tagType: "improvement",
          title: {
            tr: "'Bugün Ne Yaptım?' Markdown Günlük Raporu",
            en: "'What Did I Do Today?' Markdown Export",
          },
          desc: {
            tr: "Günlük çalışma eforunu ve tamamlanan işleri tek tıkla şık bir Markdown raporu olarak panoya kopyalama.",
            en: "One-click copy of a daily work summary formatted in clean Markdown for standups.",
          },
        },
      ],
    },
    {
      version: "v0.2.0",
      date: isTr ? "25 Eylül 2026" : "September 25, 2026",
      tagline: {
        tr: "📸 Modern Ekran Alıntısı, Çevrimdışı OCR ve Çift Tema",
        en: "📸 Screenshot Markup, Offline WinRT OCR & Dual Themes",
      },
      features: [
        {
          icon: "📸",
          tag: { tr: "Yeni Özellik", en: "New Feature" },
          tagType: "new",
          title: {
            tr: "Ekran Alıntısı & Çizim Araçları (Ctrl + Shift + S)",
            en: "Screenshot Snipping & Annotation (Ctrl + Shift + S)",
          },
          desc: {
            tr: "8 noktalı boyutlandırma, serbest kalem, ok, kutu, metin ve hassas veriler için mozaik/blur sansürleme.",
            en: "8-point selection resize, freehand pen, arrows, bounding boxes, text labels, and blur mosaic.",
          },
        },
        {
          icon: "📝",
          tag: { tr: "OCR", en: "OCR" },
          tagType: "new",
          title: {
            tr: "Yerel Windows WinRT OCR Metin Çıkarıcı",
            en: "Offline Windows WinRT OCR Text Extractor",
          },
          desc: {
            tr: "Seçilen alandaki yazıları yerel Windows OCR ile anında panoya metin olarak kopyalayabilme.",
            en: "Extracts text from screenshots locally without internet using Windows.Media.Ocr.",
          },
        },
        {
          icon: "🔍",
          tag: { tr: "Araç", en: "Tool" },
          tagType: "improvement",
          title: {
            tr: "Büyüteç & Canlı Renk Damlalığı",
            en: "Magnifier Lens & Live Color Picker",
          },
          desc: {
            tr: "Kırpma esnasında 6x yakınlaştırma ve imleç altındaki pikselin HEX/RGB rengini tek tıkla kopyalama.",
            en: "6x zoomed lens following cursor with click-to-copy HEX/RGB color readout.",
          },
        },
        {
          icon: "🌐",
          tag: { tr: "Yerelleştirme", en: "i18n" },
          tagType: "improvement",
          title: {
            tr: "Türkçe & İngilizce Dil ve Koyu/Açık Tema",
            en: "Bilingual Support & Dark/Light Themes",
          },
          desc: {
            tr: "Tüm pencerelerde anında dil değiştirme ve modern Slate-50 açık tema desteği.",
            en: "Instant Turkish/English language toggle and high-contrast light mode.",
          },
        },
      ],
    },
    {
      version: "v0.1.0",
      date: isTr ? "20 Eylül 2026" : "September 20, 2026",
      tagline: {
        tr: "🔐 Kasa Başlatıcı & Akıllı Pano Yöneticisi İlk Sürümü",
        en: "🔐 Initial Release: Vault Launcher & Smart Clipboard",
      },
      features: [
        {
          icon: "🔐",
          tag: { tr: "Temel", en: "Core" },
          tagType: "new",
          title: {
            tr: "Spotlight Tarzı Kasa Başlatıcı (Ctrl + Shift + Space)",
            en: "Spotlight-Style Vault Launcher (Ctrl + Shift + Space)",
          },
          desc: {
            tr: "İmlecin bulunduğu ekranda açılan, saniyeler içinde arama ve Enter ile şifre kopyalama sağlayan minimal arayüz.",
            en: "Cursor-aware quick search popup with instant copy and auto-paste capabilities.",
          },
        },
        {
          icon: "📋",
          tag: { tr: "Temel", en: "Core" },
          tagType: "new",
          title: {
            tr: "Gelişmiş Pano Geçmişi (Ctrl + Shift + V)",
            en: "Advanced Clipboard Manager (Ctrl + Shift + V)",
          },
          desc: {
            tr: "Metin, resim ve dosyaları yerel veritabanında saklayan çift modlu (popup/tam ekran) pano yöneticisi.",
            en: "Rich multi-format clipboard history with pin, search, and dual window modes.",
          },
        },
        {
          icon: "🛡️",
          tag: { tr: "Güvenlik", en: "Security" },
          tagType: "security",
          title: {
            tr: "Argon2id + AES-256-GCM Yerel Şifreleme",
            en: "Argon2id + AES-256-GCM Local Cryptography",
          },
          desc: {
            tr: "Askeri standartlarda yerel parola koruması ve otomatik boşta kalma kilitlemesi.",
            en: "Zero-knowledge authenticated encryption stored strictly in local SQLite.",
          },
        },
      ],
    },
  ];

  return (
    <div className="modal-overlay" style={{ zIndex: 99998 }} onClick={onClose}>
      <div
        className="modal-dialog release-notes-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header release-notes-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>✨</span>
            <div>
              <div className="modal-title" style={{ fontSize: 17 }}>
                {isTr ? "Sürüm Notları & Değişiklik Geçmişi" : "Release Notes & Changelog"}
              </div>
              <div className="modal-subtitle" style={{ fontSize: 12 }}>
                {isTr ? "PasCopyOf güncellemeleri ve yenilikler" : "What's new across PasCopyOf updates"}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title={isTr ? "Kapat (Esc)" : "Close (Esc)"}
          >
            ✕
          </button>
        </div>

        {/* Timeline Content */}
        <div className="release-notes-timeline">
          {releases.map((rel) => (
            <div key={rel.version} className={`release-card ${rel.isLatest ? "latest" : ""}`}>
              {/* Release Header */}
              <div className="release-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="release-version-pill">{rel.version}</span>
                  {rel.isLatest && (
                    <span className="release-latest-badge">
                      {isTr ? "Güncel Sürüm" : "Latest Release"}
                    </span>
                  )}
                </div>
                <span className="release-date">{rel.date}</span>
              </div>

              <div className="release-tagline">
                {isTr ? rel.tagline.tr : rel.tagline.en}
              </div>

              {/* Release Items */}
              <div className="release-features-grid">
                {rel.features.map((feat, idx) => (
                  <div key={idx} className="release-feature-item">
                    <div className="feature-icon">{feat.icon}</div>
                    <div className="feature-info">
                      <div className="feature-top">
                        <span className={`feature-tag ${feat.tagType}`}>
                          {isTr ? feat.tag.tr : feat.tag.en}
                        </span>
                        <span className="feature-title">
                          {isTr ? feat.title.tr : feat.title.en}
                        </span>
                      </div>
                      <p className="feature-desc">
                        {isTr ? feat.desc.tr : feat.desc.en}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="modal-footer release-modal-footer">
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            PasCopyOf v0.3.0 • Designed for Power Users & SysAdmins
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {isTr ? "Kapat (Esc)" : "Close (Esc)"}
          </button>
        </div>
      </div>
    </div>
  );
}
