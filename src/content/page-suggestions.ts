/**
 * Context-aware page suggestions - detects what kind of page the user is on
 * and shows a brief HUD hint for the most useful ARIA action.
 * Runs once per page mount, after a short delay so it doesn't race onboarding.
 */
import type { Hud } from './hud';

interface PageType {
  name: string;
  hint: string;
}

function detectPageType(): PageType | null {
  const url = location.href;
  const body = document.body?.innerText?.slice(0, 2000).toLowerCase() ?? '';

  // Article / blog post.
  const hasArticle = !!document.querySelector('article, [role="article"], .post, .article');
  const wordCount = body.split(/\s+/).length;
  if (hasArticle || (wordCount > 400 && document.querySelectorAll('p').length > 3)) {
    return { name: 'article', hint: 'Say "summarize" to get a quick summary of this article.' };
  }

  // Video page.
  if (document.querySelector('video')) {
    return { name: 'video', hint: 'Say "pause" or "play" to control media hands-free.' };
  }

  // Form page.
  const forms = document.querySelectorAll('form');
  const inputs = document.querySelectorAll('input:not([type=hidden]), textarea, select');
  if (forms.length > 0 && inputs.length >= 3) {
    return { name: 'form', hint: 'Say "fill this form" to auto-fill fields with your info.' };
  }

  // Search results.
  if (url.includes('google.com/search') || url.includes('bing.com/search') || url.includes('duckduckgo.com')) {
    return { name: 'search', hint: 'Say "open first result" or "click the third link".' };
  }

  // PDF viewer.
  if (document.querySelector('embed[type="application/pdf"]') || url.endsWith('.pdf')) {
    return { name: 'pdf', hint: 'Say "read aloud" to hear this document spoken.' };
  }

  // E-commerce.
  if (document.querySelector('[class*="cart"], [class*="product"], [class*="price"]')) {
    return { name: 'shop', hint: 'Say "add to cart" or "go to checkout".' };
  }

  // MCQ / quiz.
  const mcqSignals = document.querySelectorAll('input[type=radio], [class*="question"], [class*="quiz"]');
  if (mcqSignals.length >= 3) {
    return { name: 'quiz', hint: 'Say "start quiz mode" to answer questions hands-free.' };
  }

  // Social / feed.
  if (url.includes('twitter.com') || url.includes('x.com') || url.includes('reddit.com') || url.includes('news.ycombinator.com')) {
    return { name: 'feed', hint: 'Say "scroll down" or "read this post" to navigate.' };
  }

  return null;
}

export function showPageSuggestion(hud: Hud): void {
  // Only run if ARIA hasn't already shown onboarding this session.
  const type = detectPageType();
  if (!type) return;
  setTimeout(() => {
    hud.setCommand(`${type.hint}`);
    hud.show();
    // Auto-dismiss after 6s so it doesn't linger.
    setTimeout(() => hud.hide(), 6000);
  }, 2000);
}
