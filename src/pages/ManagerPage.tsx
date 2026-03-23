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
} from "../api/vault";
import type { CredentialSafe } from "../api/vault";

type EditorMode = "idle" | "new" | "edit";

interface FormState {
  keyName: string;
  username: string;
  password: string;
  notes: string;
}

const emptyForm: FormState = {
  keyName: "",
  username: "",
  password: "",
  notes: "",
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { toasts, showToast, removeToast } = useToast();

  // Check if already unlocked on mount
  useEffect(() => {
    isVaultUnlocked().then((ok) => {
      if (ok) setUnlocked(true);
    });
  }, []);

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
                    <div className="cred-item-icon">{getInitials(cred.keyName)}</div>
                    <div className="cred-item-info">
                      <div className="cred-item-name">{cred.keyName}</div>
                      <div className="cred-item-user">{cred.username || "—"}</div>
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

                  <div className="form-group">
                    <label className="form-label">Key Name</label>
                    <input
                      className="form-input"
                      value={form.keyName}
                      onChange={(e) => setForm({ ...form, keyName: e.target.value })}
                    />
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
        </>
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
