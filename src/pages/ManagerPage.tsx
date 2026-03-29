/**
 * ManagerPage.tsx — Vault management interface.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { MasterPasswordAuth } from "../components/MasterPasswordAuth";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import {
  searchCredentials,
  addCredential,
  updateCredential,
  deleteCredential,
  getDecryptedPassword,
  lockVault,
  changeMasterPassword,
  isVaultUnlocked,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
} from "../api/vault";
import type { CredentialSafe, Category } from "../api/vault";

type EditorMode = "idle" | "new" | "edit";

interface FormState {
  keyName: string;
  username: string;
  password: string;
  notes: string;
  categoryId: number | null;
}

const emptyForm: FormState = {
  keyName: "",
  username: "",
  password: "",
  notes: "",
  categoryId: null,
};

export default function ManagerPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [credentials, setCredentials] = useState<CredentialSafe[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("idle");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePwForm, setChangePwForm] = useState({ current: "", next: "", confirm: "" });
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [catForm, setCatForm] = useState({ id: null as number | null, name: "", icon: "Key", color: "#0ea5e9" });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { toasts, showToast, removeToast } = useToast();

  // Check if already unlocked on mount
  useEffect(() => {
    isVaultUnlocked().then((ok) => {
      if (ok) {
        setUnlocked(true);
        loadCategories();
      }
    });
  }, []);

  const loadCategories = async () => {
    try {
      const cats = await getCategories();
      setCategories(cats);
    } catch (e) {
      console.error(e);
    }
  };

  // Load all credentials
  const loadCredentials = useCallback(async (q = "") => {
    try {
      const list = await searchCredentials(q);
      setCredentials(list);
    } catch {
      showToast("Failed to load credentials", "error");
    }
  }, [showToast]);

  useEffect(() => {
    if (unlocked) {
      loadCredentials();
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [unlocked, loadCredentials]);

  // Filtered credentials based on search
  const filtered = credentials.filter(
    (c) =>
      (c.keyName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.username || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Editor actions ──────────────────────────────────────────────────────────

  function handleNewCredential() {
    setSelectedId(null);
    setForm(emptyForm);
    setShowPassword(false);
    setEditorMode("new");
  }

  async function handleSelectCredential(cred: CredentialSafe) {
    setSelectedId(cred.id);
    setShowPassword(false);
    setEditorMode("edit");
    setForm({
      keyName: cred.keyName || "",
      username: cred.username || "",
      password: "",
      notes: cred.notes || "",
      categoryId: cred.categoryId,
    });
  }

  async function handleRevealPassword() {
    if (!selectedId) return;
    try {
      const pw = await getDecryptedPassword(selectedId);
      setForm((f) => ({ ...f, password: pw }));
      setShowPassword(true);
    } catch {
      showToast("Failed to decrypt password", "error");
    }
  }

  async function handleSave() {
    if (!form.keyName.trim()) {
      showToast("Key name is required", "error");
      return;
    }
    if (editorMode === "new" && !form.password) {
      showToast("Password is required for new credentials", "error");
      return;
    }

    setSaving(true);
    try {
      if (editorMode === "new") {
        const newId = await addCredential({ ...form });
        showToast(`✓ "${form.keyName}" added`, "success");
        await loadCredentials(searchQuery);
        setSelectedId(newId);
        setEditorMode("edit");
      } else if (editorMode === "edit" && selectedId !== null) {
        await updateCredential({ id: selectedId, ...form });
        showToast(`✓ "${form.keyName}" updated`, "success");
        await loadCredentials(searchQuery);
      }
      setShowPassword(false);
    } catch (err) {
      showToast(`Error: ${String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (selectedId === null) return;
    try {
      await deleteCredential(selectedId);
      showToast("Credential deleted", "success");
      setSelectedId(null);
      setEditorMode("idle");
      setShowDeleteConfirm(false);
      await loadCredentials(searchQuery);
    } catch (err) {
      showToast(`Error: ${String(err)}`, "error");
    }
  }

  async function handleLock() {
    await lockVault();
    setUnlocked(false);
    setCredentials([]);
    setSelectedId(null);
    setEditorMode("idle");
  }

  // ── Change master password ──────────────────────────────────────────────────

  async function handleChangeMasterPassword(e: React.FormEvent) {
    e.preventDefault();

    if (changePwForm.next.length < 8) {
      showToast("New password must be at least 8 characters.", "error");
      return;
    }
    if (changePwForm.next !== changePwForm.confirm) {
      showToast("New passwords do not match.", "error");
      return;
    }

    try {
      await changeMasterPassword(changePwForm.current, changePwForm.next);
      showToast("✓ Master password changed", "success");
      setShowChangePassword(false);
      setChangePwForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getInitials(name: string) {
    if (!name) return "??";
    return name.slice(0, 2).toLowerCase();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="manager-root">
      {!unlocked && <MasterPasswordAuth onUnlocked={() => setUnlocked(true)} />}

      {unlocked && (
        <>
          <div className="manager-topbar">
            <div className="manager-logo">
              <div className="manager-logo-dot" />
              PasCopyOf Admin
            </div>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {credentials.length} credentials
            </span>

            <div className="manager-topbar-right">
              <button className="btn btn-secondary" onClick={() => setShowCategoryManager(true)}>📂 Categories</button>
              <button className="btn btn-primary" onClick={handleNewCredential}>+ Add Credential</button>
              <button className="btn btn-secondary" onClick={() => setShowChangePassword(true)}>🔑 Security</button>
              <button className="btn btn-secondary" onClick={handleLock}>🔒 Lock</button>
            </div>
          </div>

          <div className="manager-content">
            <div className="credential-list-panel">
              <div className="list-header">
                <div className="list-search">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Filter credentials…"
                    value={searchQuery}
                    onChange={handleSearchChange}
                  />
                </div>
              </div>

              <div className="credential-list">
                {filtered.map((cred) => (
                  <div
                    key={cred.id}
                    className={`cred-item ${selectedId === cred.id ? "active" : ""}`}
                    onClick={() => handleSelectCredential(cred)}
                  >
                    <div className="cred-item-icon" style={{ 
                        background: cred.categoryId ? categories.find(c => c.id === cred.categoryId)?.color + '22' : 'transparent',
                        color: cred.categoryId ? categories.find(c => c.id === cred.categoryId)?.color : 'inherit'
                      }}>
                        {getInitials(cred.keyName)}
                    </div>
                    <div className="cred-item-info">
                      <div className="cred-item-name">{cred.keyName}</div>
                      <div className="cred-item-user">{cred.username || "—"}</div>
                      {cred.categoryId && (
                        <div className="credential-category-tag" style={{ border: `1px solid ${categories.find(c => c.id === cred.categoryId)?.color}55`, color: categories.find(c => c.id === cred.categoryId)?.color }}>
                          {categories.find(c => c.id === cred.categoryId)?.name}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="editor-panel">
              {editorMode === "idle" ? (
                <div className="editor-empty">Select a credential to manage.</div>
              ) : (
                <div className="editor-form">
                  <div className="editor-header">
                    <div className="editor-title">
                      {editorMode === "new" ? "New Credential" : form.keyName}
                    </div>
                  </div>

                  <div className="form-group-row">
                    <div className="form-group">
                      <label className="form-label">Key Name</label>
                      <input
                        className="form-input"
                        value={form.keyName}
                        onChange={(e) => setForm({ ...form, keyName: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Category</label>
                      <select 
                        className="form-input"
                        value={form.categoryId || ""}
                        onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">No Category</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input
                      className="form-input"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <div className="form-input-wrap">
                      <input
                        type={showPassword ? "text" : "password"}
                        className="form-input"
                        placeholder={editorMode === "edit" ? "••••••••" : "Enter password…"}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                      />
                      <button
                        type="button"
                        className="form-input-action"
                        onClick={editorMode === "edit" && !showPassword ? handleRevealPassword : () => setShowPassword(!showPassword)}
                      >
                        {showPassword ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <textarea
                      className="form-textarea"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    {editorMode === "edit" && (
                      <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>Delete</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {showDeleteConfirm && (
            <div className="modal-overlay">
              <div className="modal-card">
                <div className="modal-title">Delete?</div>
                <p>Are you sure you want to delete {form.keyName}?</p>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
                </div>
              </div>
            </div>
          )}

          {showChangePassword && (
            <div className="modal-overlay">
              <div className="modal-card">
                <div className="modal-title">Change Master Password</div>
                <form onSubmit={handleChangeMasterPassword}>
                  <input
                    type="password"
                    placeholder="Current Password"
                    className="form-input"
                    value={changePwForm.current}
                    onChange={(e) => setChangePwForm({ ...changePwForm, current: e.target.value })}
                  />
                  <input
                    type="password"
                    placeholder="New Password"
                    className="form-input"
                    value={changePwForm.next}
                    onChange={(e) => setChangePwForm({ ...changePwForm, next: e.target.value })}
                  />
                  <input
                    type="password"
                    placeholder="Confirm New Password"
                    className="form-input"
                    value={changePwForm.confirm}
                    onChange={(e) => setChangePwForm({ ...changePwForm, confirm: e.target.value })}
                  />
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowChangePassword(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Update</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {showCategoryManager && (
            <div className="modal-overlay">
              <div className="modal-card" style={{ width: 500 }}>
                <div className="modal-title">Manage Categories</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                  <div className="credential-list" style={{ maxHeight: 200, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    {categories.map(cat => (
                      <div key={cat.id} className="cred-item" onClick={() => setCatForm({ id: cat.id, name: cat.name, icon: cat.icon, color: cat.color })}>
                        <div className="cred-item-icon" style={{ background: cat.color + '22', color: cat.color }}>{cat.name[0]}</div>
                        <div className="cred-item-info">
                          <div className="cred-item-name">{cat.name}</div>
                          <div className="cred-item-user" style={{ opacity: 0.6 }}>Icon: {cat.icon}</div>
                        </div>
                        <button className="btn btn-danger btn-icon" onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id).then(loadCategories); }}>🗑</button>
                      </div>
                    ))}
                    {categories.length === 0 && <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>No categories yet.</div>}
                  </div>

                  <div className="editor-form" style={{ background: 'rgba(255,255,255,0.02)', padding: 15, borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{catForm.id ? "Edit Category" : "New Category"}</div>
                    <div className="form-group">
                      <label className="form-label">Name</label>
                      <input className="form-input" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} placeholder="e.g. DB, VPN, RDP..." />
                    </div>
                    <div className="form-group-row">
                      <div className="form-group">
                        <label className="form-label">Icon</label>
                        <select className="form-input" value={catForm.icon} onChange={e => setCatForm({...catForm, icon: e.target.value})}>
                          <option value="Database">Database</option>
                          <option value="Network">VPN / Network</option>
                          <option value="Terminal">RDP / SSH</option>
                          <option value="Cloud">Cloud</option>
                          <option value="Code">Source Code</option>
                          <option value="Key">General Password</option>
                          <option value="Shield">Security</option>
                          <option value="Mail">Email</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Color</label>
                        <input type="color" className="form-input" style={{ padding: 4, height: 38 }} value={catForm.color} onChange={e => setCatForm({...catForm, color: e.target.value})} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn btn-primary" onClick={async () => {
                        if (!catForm.name) return;
                        if (catForm.id) {
                          await updateCategory(catForm.id, catForm.name, catForm.icon, catForm.color);
                        } else {
                          await addCategory(catForm.name, catForm.icon, catForm.color);
                        }
                        setCatForm({ id: null, name: "", icon: "Key", color: "#0ea5e9" });
                        loadCategories();
                      }}>{catForm.id ? "Update" : "Add"}</button>
                      {catForm.id && <button className="btn btn-secondary" onClick={() => setCatForm({ id: null, name: "", icon: "Key", color: "#0ea5e9" })}>Clear</button>}
                    </div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowCategoryManager(false)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
