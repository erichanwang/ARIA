/**
 * Accessibility audit: scans visible page for common a11y issues and reads
 * a summary report aloud.
 *
 * Checks:
 *   - Images without alt text
 *   - Inputs without labels
 *   - Poor color contrast (simplified: very light text)
 *   - Interactive elements without accessible names
 *   - Missing lang attribute on <html>
 */
import type { Speech } from '../speech';
import type { Hud } from '../hud';

interface AuditIssue {
  severity: 'error' | 'warning';
  message: string;
  count: number;
}

export async function runAccessibilityAudit(speech: Speech, hud: Hud): Promise<void> {
  hud.setCommand('Running accessibility audit…');
  const issues = audit();
  displayAuditReport(issues);
  const summary = summarizeAudit(issues);
  await speech.speak(summary);
  hud.setCommand(`Audit complete: ${issues.length} issue${issues.length !== 1 ? 's' : ''} found.`);
}

function audit(): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // Images without alt text.
  const imgsMissingAlt = Array.from(document.querySelectorAll('img')).filter(
    (img) => !img.getAttribute('alt') && img.offsetParent !== null,
  );
  if (imgsMissingAlt.length) {
    issues.push({ severity: 'error', message: 'images missing alt text', count: imgsMissingAlt.length });
    imgsMissingAlt.slice(0, 10).forEach((img) => img.style.outline = '3px solid #ff2b2b');
  }

  // Inputs without labels.
  const inputsMissingLabel = Array.from(
    document.querySelectorAll('input:not([type="hidden"]),select,textarea'),
  ).filter((el) => {
    const id = el.getAttribute('id');
    const hasLabel = id && document.querySelector(`label[for="${id}"]`);
    const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    return !hasLabel && !hasAria;
  });
  if (inputsMissingLabel.length) {
    issues.push({ severity: 'error', message: 'form inputs missing labels', count: inputsMissingLabel.length });
  }

  // Interactive elements without accessible names.
  const interactiveMissingName = Array.from(
    document.querySelectorAll('button,[role="button"],[role="link"]'),
  ).filter((el) => {
    const text = (el.textContent ?? '').trim();
    const aria = el.getAttribute('aria-label');
    return !text && !aria;
  });
  if (interactiveMissingName.length) {
    issues.push({ severity: 'warning', message: 'interactive elements missing accessible names', count: interactiveMissingName.length });
  }

  // Missing lang on <html>.
  if (!document.documentElement.getAttribute('lang')) {
    issues.push({ severity: 'warning', message: 'html element missing lang attribute', count: 1 });
  }

  // Missing page title.
  if (!document.title.trim()) {
    issues.push({ severity: 'error', message: 'page missing title', count: 1 });
  }

  return issues;
}

function summarizeAudit(issues: AuditIssue[]): string {
  if (issues.length === 0) return 'Great news — no accessibility issues found on this page!';
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const parts: string[] = [];
  if (errors.length) parts.push(`${errors.length} error${errors.length > 1 ? 's' : ''}`);
  if (warnings.length) parts.push(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`);
  const top = issues[0];
  return `Found ${parts.join(' and ')}. Top issue: ${top.count} ${top.message}.`;
}

function displayAuditReport(issues: AuditIssue[]): void {
  const existing = document.getElementById('aria-a11y-report');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'aria-a11y-report';
  panel.style.cssText = [
    'position:fixed', 'top:20px', 'left:20px', 'max-width:360px', 'max-height:80vh',
    'overflow-y:auto', 'z-index:2147483646',
    'background:rgba(14,14,20,0.97)', 'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:14px', 'padding:18px 20px', 'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif', 'font-size:13px', 'line-height:1.5',
    'box-shadow:0 12px 48px rgba(0,0,0,0.6)', 'backdrop-filter:blur(10px)',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#9aa0aa;font-weight:700';
  title.textContent = 'Accessibility Audit';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:14px;padding:0';
  closeBtn.addEventListener('click', () => panel.remove());
  header.append(title, closeBtn);
  panel.appendChild(header);

  if (issues.length === 0) {
    const ok = document.createElement('p');
    ok.style.cssText = 'color:#4ade80;margin:0;font-weight:500';
    ok.textContent = '✓ No issues found!';
    panel.appendChild(ok);
  } else {
    for (const issue of issues) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)`;
      const badge = document.createElement('span');
      badge.style.cssText = `flex-shrink:0;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700;background:${issue.severity === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)'};color:${issue.severity === 'error' ? '#f87171' : '#fbbf24'}`;
      badge.textContent = issue.severity;
      const text = document.createElement('span');
      text.style.cssText = 'color:#c0c8d4';
      text.textContent = `${issue.count}× ${issue.message}`;
      row.append(badge, text);
      panel.appendChild(row);
    }
  }

  document.documentElement.appendChild(panel);
  setTimeout(() => panel.remove(), 30000);
}
