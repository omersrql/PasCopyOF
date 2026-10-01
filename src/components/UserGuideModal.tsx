/**
 * UserGuideModal.tsx — Comprehensive In-App User Guide & Help Center.
 * Provides interactive documentation, troubleshooting, and tips.
 */
import { useState, useEffect, type ReactNode } from "react";
import { useApp } from "../context/AppContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface GuideSection {
  id: string;
  icon: string;
  title: string;
  badge?: string;
  content: ReactNode;
}

export function UserGuideModal({ isOpen, onClose }: Props) {
  const { lang } = useApp();
  const [activeSection, setActiveSection] = useState("vault");
  const [searchQuery, setSearchQuery] = useState("");

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

  const sections: GuideSection[] = [
    {
      id: "vault",
      icon: "🛡️",
      title: isTr ? "Kasa & Güvenlik" : "Vault & Security",
      badge: isTr ? "Temel" : "Core",
      content: (
        <div className="guide-content-flow">
          <div className="guide-hero-banner">
            <div className="guide-hero-icon">🔐</div>
            <div>
              <h4>{isTr ? "Sıfır Bilgi (Zero-Knowledge) Yerel Kasa" : "Zero-Knowledge Local Vault"}</h4>
              <p>
                {isTr
                  ? "PasCopyOf, parolalarınızı ve hassas verilerinizi hiçbir sunucuya göndermeden cihazınızda Argon2id ve AES-256-GCM algoritmalarıyla şifreli olarak saklar."
                  : "PasCopyOf stores your credentials locally with Argon2id and AES-256-GCM encryption without ever sending data to external cloud servers."}
              </p>
            </div>
          </div>

          <div className="guide-card-block">
            <h5>{isTr ? "1. İlk Kurulum ve Güçlü Ana Parola" : "1. Initial Setup & Strong Password"}</h5>
            <p>
              {isTr
                ? "Uygulamayı ilk açtığınızda 3 adımlı kurulum sihirbazı karşılar. Parolanız en az 8 karakter olmalı; büyük/küçük harf ve rakam/sembol içermelidir. Canlı güç göstergesi ile parolanızın güvenliğini anında görebilirsiniz."
                : "When you first open the app, a 3-step setup wizard guides you. Your master password must be at least 8 chars long with mixed-case and numbers/symbols."}
            </p>
          </div>

          <div className="guide-card-block highlight">
            <h5>{isTr ? "2. Acil Durum Kurtarma Anahtarı (Emergency Kit)" : "2. Emergency Recovery Key"}</h5>
            <p>
              {isTr
                ? "Kasanız oluşturulduğunda size özel 24 haneli kriptografik bir kurtarma anahtarı üretilir (Örn: PCYF-A8K2-9M4P-W7XZ-3B6Q-2Y4T). Bu anahtarı mutlaka 'Panoya Kopyala' veya 'Dosya İndir' butonlarıyla güvenli bir yere kaydedin. Ana şifrenizi unutursanız şifrelerinizi kurtarmanın TEK yolu bu anahtardır!"
                : "A 24-character cryptographic key is generated during setup (e.g. PCYF-A8K2-...). Save this key safely! It is the ONLY way to recover your vault without data loss if you forget your master password."}
            </p>
          </div>

          <div className="guide-card-block">
            <h5>{isTr ? "3. Parola İpucu (Password Hint)" : "3. Password Hint"}</h5>
            <p>
              {isTr
                ? "Kurulum esnasında veya Ayarlar -> Güvenlik sekmesinden parolanızı hatırlatacak bir ipucu tanımlayabilirsiniz. Kilit ekranında '💡 İpucunu Göster' butonuyla veya hatalı denemelerden sonra görüntülenebilir."
                : "You can define an optional hint during setup or in Settings -> Security. Visible on the lock screen via '💡 Show Hint'."}
            </p>
          </div>

          <div className="guide-card-block danger">
            <h5>{isTr ? "4. Şifremi Unuttum veya Kasayı Sıfırlama" : "4. Forgot Password & Clean Reset"}</h5>
            <p>
              {isTr
                ? "Kilit ekranında '🆘 Şifremi Unuttum' linkine tıklayarak Kurtarma Anahtarınızı girebilir ve sıfır veri kaybı ile yeni bir parola belirleyebilirsiniz. Eğer anahtarınızı da kaybettiyseniz 'Kasayı Sıfırla' sekmesinden onay vererek yalnızca çözülemeyen şifreleri silebilir; görevlerinizi ve pano geçmişinizi kaybetmeden temiz bir başlangıç yapabilirsiniz."
                : "Click '🆘 Forgot Password' on the lock screen to use your recovery key. If you lost both password and key, you can cleanly reset the vault without losing tasks or clipboard history."}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "shortcuts",
      icon: "⌨️",
      title: isTr ? "Kısayollar & Hızlı Erişim" : "Hotkeys & Shortcuts",
      badge: isTr ? "Verimlilik" : "Productivity",
      content: (
        <div className="guide-content-flow">
          <p className="guide-desc">
            {isTr
              ? "PasCopyOf arka planda çalışırken dahi aşağıdaki küresel kısayollar ile tüm özelliklere her yerden anında erişebilirsiniz:"
              : "Global hotkeys allow you to access any feature instantly across any Windows application:"}
          </p>

          <div className="guide-shortcut-table">
            <div className="guide-shortcut-row">
              <div className="shortcut-meta">
                <span className="shortcut-icon">🔑</span>
                <div>
                  <strong>{isTr ? "Kasa Hızlı Başlatıcı" : "Vault Quick Launcher"}</strong>
                  <p>{isTr ? "İmlecin bulunduğu ekranda arama kutusu açar. Enter: şifre, Ctrl+Enter: kullanıcı adı kopyalar." : "Opens quick search popup at cursor. Enter copies password, Ctrl+Enter copies username."}</p>
                </div>
              </div>
              <kbd className="guide-kbd">Ctrl + Shift + Space</kbd>
            </div>

            <div className="guide-shortcut-row">
              <div className="shortcut-meta">
                <span className="shortcut-icon">📋</span>
                <div>
                  <strong>{isTr ? "Akıllı Pano Geçmişi" : "Smart Clipboard History"}</strong>
                  <p>{isTr ? "Kopyalanan metin, görsel ve dosyaları listeler. Çift tıklama veya Enter ile yapıştırır." : "Opens clipboard history with text, images, and files."}</p>
                </div>
              </div>
              <kbd className="guide-kbd">Ctrl + Shift + V</kbd>
            </div>

            <div className="guide-shortcut-row">
              <div className="shortcut-meta">
                <span className="shortcut-icon">📸</span>
                <div>
                  <strong>{isTr ? "Ekran Alıntısı & OCR" : "Screenshot & OCR"}</strong>
                  <p>{isTr ? "Alan seçerek ekran görüntüsü alır, resimden metin çıkarır (OCR) ve çizim yapmayı sağlar." : "Snipping tool with annotations, color picker, and offline OCR."}</p>
                </div>
              </div>
              <kbd className="guide-kbd">Ctrl + Shift + S</kbd>
            </div>

            <div className="guide-shortcut-row">
              <div className="shortcut-meta">
                <span className="shortcut-icon">⚡</span>
                <div>
                  <strong>{isTr ? "Hızlı Görev Oluşturucu" : "Quick Task Popup"}</strong>
                  <p>{isTr ? "Açılan mini popup'a görev yazıp Enter'a basınca anında görev açılır ve sayaç başlar." : "Opens quick task creator; typing title and hitting Enter starts focus timer instantly."}</p>
                </div>
              </div>
              <kbd className="guide-kbd">Ctrl + Shift + N</kbd>
            </div>

            <div className="guide-shortcut-row">
              <div className="shortcut-meta">
                <span className="shortcut-icon">⏱️</span>
                <div>
                  <strong>{isTr ? "Yüzen Sayaç Göster/Gizle" : "Toggle Floating Timer"}</strong>
                  <p>{isTr ? "Masaüstündeki mini yüzen odak sayacını tek tuşla ekrana getirir veya gizler." : "Toggles the desktop floating mini timer widget on/off."}</p>
                </div>
              </div>
              <kbd className="guide-kbd">Ctrl + Shift + T</kbd>
            </div>

            <div className="guide-shortcut-row">
              <div className="shortcut-meta">
                <span className="shortcut-icon">🎯</span>
                <div>
                  <strong>{isTr ? "Görev Yöneticisi & Planlayıcı" : "Task Planner Window"}</strong>
                  <p>{isTr ? "Günlük görevlerinizi, alt maddeleri ve efor geçmişinizi açar." : "Opens the task planner and daily worklogs dashboard."}</p>
                </div>
              </div>
              <kbd className="guide-kbd">Ctrl + Shift + P</kbd>
            </div>
          </div>

          <div className="guide-tip-box">
            💡 {isTr
              ? "Tüm kısayol tuşlarını Ayarlar -> Kısayol Tuşları sekmesinden dilediğiniz gibi özelleştirebilirsiniz."
              : "You can customize all hotkeys anytime in Settings -> Global Hotkeys."}
          </div>
        </div>
      ),
    },
    {
      id: "clipboard",
      icon: "📋",
      title: isTr ? "Pano Geçmişi" : "Clipboard History",
      content: (
        <div className="guide-content-flow">
          <div className="guide-card-block">
            <h5>{isTr ? "Metin, Resim ve Dosya Desteği" : "Rich Media History"}</h5>
            <p>
              {isTr
                ? "Kopyaladığınız her metin, ekran görüntüsü veya Windows dosya seçimi anında yerel veritabanına eklenir. Görseller yerel önbellekte saklanır, sistem kaynaklarını tüketmez."
                : "Every copied text, screenshot, or file batch is stored safely in local SQLite with fast thumbnail previews."}
            </p>
          </div>

          <div className="guide-card-block highlight">
            <h5>{isTr ? "Kasaya Tek Tıkla Kaydetme (Ctrl + S)" : "Save Directly to Vault (Ctrl + S)"}</h5>
            <p>
              {isTr
                ? "Pano geçmişinde kopyalanmış herhangi bir metin kartının üzerinde 'Kasaya Kaydet' (🛡️) butonuna basarak veya kart seçiliyken Ctrl+S yaparak metni doğrudan şifreli parola kasanıza kalıcı olarak ekleyebilirsiniz."
                : "You can click the 'Save to Vault' button on any text clip in history to store it permanently inside your encrypted password vault."}
            </p>
          </div>

          <div className="guide-card-block">
            <h5>{isTr ? "Kasa Parolası Kalkanı (Vault Shield)" : "Vault Password Shield"}</h5>
            <p>
              {isTr
                ? "PasCopyOf kasasından kopyaladığınız parolalar, güvenlik gereği pano geçmişine ASLA kaydedilmez. Böylece hassas şifreleriniz geçmişte görünmez."
                : "Passwords copied from your PasCopyOf Vault are automatically excluded from clipboard history for zero leakage."}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "tasks",
      icon: "⏱️",
      title: isTr ? "Görevler & Yüzen Sayaç" : "Tasks & Focus Timer",
      badge: isTr ? "Popüler" : "Popular",
      content: (
        <div className="guide-content-flow">
          <div className="guide-card-block">
            <h5>{isTr ? "1. Yüzen Mini Sayaç Widget'ı" : "1. Floating Desktop Timer"}</h5>
            <p>
              {isTr
                ? "Masaüstünde her zaman en üstte duran mini sayaç, çalıştığınız görevi ve geçen süreyi gösterir. Tutamaç (⋮⋮) simgesinden tutarak ekranın dilediğiniz köşesine sürükleyebilirsiniz."
                : "A mini, always-on-top translucent widget showing your active task title and live timer. Drag it anywhere on multi-monitor setups."}
            </p>
          </div>

          <div className="guide-card-block highlight">
            <h5>{isTr ? "2. Çift Tıklama ile Göreve Gitme" : "2. Double-Click to Jump to Task"}</h5>
            <p>
              {isTr
                ? "Sayaç widget'ına çift tıkladığınızda veya '↗' butonuna bastığınızda, Yönetici penceresi otomatik açılarak ilgili görevin detaylarını ve kontrol listesini ekrana getirir."
                : "Double-clicking the floating timer widget or clicking '↗' immediately opens the Manager and focuses on that active task."}
            </p>
          </div>

          <div className="guide-card-block">
            <h5>{isTr ? "3. Akıllı Boşta Kalma & Ekran Kilidi Algılama" : "3. Smart Idle & Lock Screen Detection"}</h5>
            <p>
              {isTr
                ? "Bilgisayarınızı kilitlediğinizde (Win+L) veya 60 saniye boyunca fare/klavye hareketi olmadığında sayaç otomatik duraklatılır ve boşta geçen süre silinir. Masaya dönüp fareyi oynattığınızda otomatik kaldığı yerden devam eder!"
                : "If you lock Windows (Win+L) or stay inactive for 60 seconds, the timer pauses automatically. When you return, it auto-resumes seamlessly."}
            </p>
          </div>

          <div className="guide-card-block">
            <h5>{isTr ? "4. Hızlı Görev Açma (Ctrl + Shift + N)" : "4. Quick Task Creator (Ctrl + Shift + N)"}</h5>
            <p>
              {isTr
                ? "Kod yazarken veya çalışırken aniden yeni bir iş çıktığında Ctrl+Shift+N ile hızlı popup'ı açın, görevi yazın ve Enter'a basın; görev açılır ve sayacı hemen başlar."
                : "Hit Ctrl+Shift+N anywhere to pop open the quick task modal, type what you are doing, and press Enter to start tracking immediately."}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "screenshot",
      icon: "📸",
      title: isTr ? "Ekran Alıntısı & OCR" : "Screenshot & OCR",
      content: (
        <div className="guide-content-flow">
          <div className="guide-card-block">
            <h5>{isTr ? "Kırpma & 8 Noktalı Boyutlandırma" : "Snipping & 8-Point Resize"}</h5>
            <p>
              {isTr
                ? "Ctrl+Shift+S ile ekran kararır. Fare ile alanı seçin. Çerçeve kenarlarındaki 8 tutamaç ile seçimi milimetrik ayarlayabilir, ortasından tutarak taşıyabilirsiniz."
                : "Hit Ctrl+Shift+S, drag to select any region. Use the 8 perimeter handles to adjust your crop area with precision."}
            </p>
          </div>

          <div className="guide-card-block highlight">
            <h5>{isTr ? "Çevrimdışı WinRT OCR (Resimden Metin Kopyalama)" : "Offline OCR Text Extractor"}</h5>
            <p>
              {isTr
                ? "Kırpma çubuğundaki '📝 OCR Metin Çıkar' butonuna bastığınızda seçili alandaki tüm yazılar yerel Windows OCR motoru ile saniyeler içinde taranır ve doğrudan panonuza kopyalanır."
                : "Click '📝 OCR' to extract text from any selected area using Windows native offline OCR engine with full Turkish & English support."}
            </p>
          </div>

          <div className="guide-card-block">
            <h5>{isTr ? "Çizim, Ok, Sansür (Blur) ve Adım Rozetleri" : "Annotations, Blur & Step Badges"}</h5>
            <p>
              {isTr
                ? "Ekran görüntüsü üzerinde hassas verileri bulanıklaştırmak için 'B' (Blur), adımları numaralandırmak için 'S' (Step Badges: ①, ②...), ok ve kutu çizmek için 'A' ve 'R' tuşlarını kullanabilirsiniz."
                : "Use 'B' for instant blur/mosaic censoring, 'S' for numbered step badges (①, ②...), and 'A'/'R' for sharp arrows and boxes."}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "faq",
      icon: "❓",
      title: isTr ? "Sıkça Sorulan Sorular" : "FAQ",
      content: (
        <div className="guide-content-flow">
          <div className="guide-faq-item">
            <div className="faq-q">{isTr ? "❓ Verilerim buluta veya internete gidiyor mu?" : "❓ Is my data sent to the cloud?"}</div>
            <div className="faq-a">
              {isTr
                ? "Hayır. PasCopyOf %100 yerel (offline-first) bir uygulamadır. Kasanız, pano geçmişiniz ve görevleriniz yalnızca bilgisayarınızdaki şifreli SQLite veritabanında saklanır."
                : "No. PasCopyOf is 100% offline-first. Your vault, clipboard, and tasks remain strictly on your local computer."}
            </div>
          </div>

          <div className="guide-faq-item">
            <div className="faq-q">{isTr ? "❓ Ana şifremi unutursam verilerim silinir mi?" : "❓ What happens if I forget my master password?"}</div>
            <div className="faq-a">
              {isTr
                ? "Kurulumda size verilen 24 haneli Acil Durum Kurtarma Anahtarınız varsa HİÇBİR VERİ KAYBI OLMADAN kasanızı açabilir ve yeni bir parola belirleyebilirsiniz. Her iki anahtarı da kaybettiyseniz 'Kasayı Sıfırla' ile kasanızı temiz sıfırlayabilirsiniz (görevleriniz korunur)."
                : "If you have your 24-character Emergency Recovery Key, you can recover your vault with zero data loss. If both are lost, you can cleanly reset the vault without touching your tasks."}
            </div>
          </div>

          <div className="guide-faq-item">
            <div className="faq-q">{isTr ? "❓ Ekran görüntüleri nereye kaydediliyor?" : "❓ Where are screenshots saved?"}</div>
            <div className="faq-a">
              {isTr
                ? "Varsayılan olarak 'Resimler\\PasCopyOf' klasörüne kaydedilir. Ayarlar -> Ekran Alıntısı sekmesinden dilediğiniz klasörü seçebilir veya tek tıkla klasörü açabilirsiniz."
                : "By default, screenshots are saved to 'Pictures\\PasCopyOf'. You can customize this folder anytime in Settings -> Screenshot."}
            </div>
          </div>

          <div className="guide-faq-item">
            <div className="faq-q">{isTr ? "❓ Farklı bilgisayara nasıl aktarabilirim?" : "❓ How do I migrate to another computer?"}</div>
            <div className="faq-a">
              {isTr
                ? "Ayarlar -> Güvenlik sekmesindeki 'Export Backup (.pascopyof)' butonunu kullanarak şifreli yedek alabilir ve diğer cihazınızda 'Restore Backup' ile kolayca yükleyebilirsiniz."
                : "Use Settings -> Security -> 'Export Backup (.pascopyof)' to export an encrypted backup and restore it on another PC."}
            </div>
          </div>
        </div>
      ),
    },
  ];

  const filteredSections = searchQuery.trim()
    ? sections.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sections;

  const currentSection =
    sections.find((s) => s.id === activeSection) || sections[0];

  return (
    <div className="modal-overlay" style={{ zIndex: 99998 }} onClick={onClose}>
      <div
        className="modal-dialog guide-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header guide-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>📖</span>
            <div>
              <div className="modal-title" style={{ fontSize: 17 }}>
                {isTr ? "PasCopyOf Kullanım Kılavuzu & Yardım Merkezi" : "PasCopyOf User Guide & Help Center"}
              </div>
              <div className="modal-subtitle" style={{ fontSize: 12 }}>
                {isTr
                  ? "Tüm özellikler, kısayollar, ipuçları ve sıkça sorulan sorular"
                  : "Comprehensive documentation, shortcuts, tips, and FAQ"}
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

        {/* Search Bar */}
        <div className="guide-search-container">
          <input
            type="text"
            className="form-input guide-search-input"
            placeholder={
              isTr
                ? "Kılavuzda konu veya soru ara... (Örn: kurtarma, sayaç, ocr, kısayol)"
                : "Search guide... (e.g. recovery, timer, ocr, shortcut)"
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Body Layout: Sidebar + Main Content */}
        <div className="guide-body-layout">
          {/* Navigation Sidebar */}
          <div className="guide-sidebar">
            {filteredSections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                className={`guide-nav-item ${activeSection === sec.id ? "active" : ""}`}
                onClick={() => setActiveSection(sec.id)}
              >
                <span className="guide-nav-icon">{sec.icon}</span>
                <span className="guide-nav-title">{sec.title}</span>
                {sec.badge && <span className="guide-nav-badge">{sec.badge}</span>}
              </button>
            ))}
          </div>

          {/* Section Content Display */}
          <div className="guide-main-pane">
            <div className="guide-section-header">
              <span style={{ fontSize: 22 }}>{currentSection.icon}</span>
              <h3>{currentSection.title}</h3>
            </div>
            {currentSection.content}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer guide-modal-footer">
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            PasCopyOf v0.3.0 • Offline & Secure
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {isTr ? "Kapat (Esc)" : "Close (Esc)"}
          </button>
        </div>
      </div>
    </div>
  );
}
