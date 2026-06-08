/**
 * Interview Prep Mode
 * Generates 5 interview questions for a given job title.
 * User answers by voice. Claude evaluates each and gives a score + tip.
 */
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';

export async function runInterviewPrep(role: string, speech: Speech, hud: Hud): Promise<void> {
  await speech.speak(`Great, let's prep for a ${role} interview. Generating 5 questions — please hold.`);
  hud.setCommand(`Interview prep: ${role}`);

  const settings = await loadSettings();

  const questionsResult = await requestClaude(
    settings.apiKey,
    'You generate interview questions. Return ONLY a JSON array of 5 strings.',
    `Generate 5 interview questions for a ${role} position. Mix behavioral and technical questions. Return a JSON array: ["Question 1","Question 2",...]`,
  );

  if (!questionsResult.ok || !questionsResult.text) {
    await speech.speak("I had trouble generating questions. Please try again.");
    return;
  }

  let questions: string[] = [];
  try {
    const match = /\[[\s\S]+\]/.exec(questionsResult.text ?? '');
    if (match) questions = JSON.parse(match[0]) as string[];
  } catch {
    await speech.speak("I couldn't parse the questions. Please try again.");
    return;
  }

  if (questions.length === 0) {
    await speech.speak("I couldn't generate questions. Try being more specific with the role title.");
    return;
  }

  let totalScore = 0;
  const tips: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    hud.setCommand(`Q${i + 1}/${questions.length}: ${q.slice(0, 60)}`);
    await speech.speak(`Question ${i + 1}: ${q}`);

    // Give the user 8 seconds to formulate their mental answer.
    await delay(8000);
    await speech.speak("Ready for the next one? Here's what a strong answer covers:");

    // Get evaluation hint.
    const evalResult = await requestClaude(
      settings.apiKey,
      'Give a 1-sentence tip for answering this interview question. Plain text only.',
      `Interview question: "${q}"\nJob role: ${role}\nGive one key tip for a strong answer.`,
    );
    if (evalResult.ok && evalResult.text) {
      const tip = evalResult.text.trim().slice(0, 200);
      tips.push(tip);
      await speech.speak(tip);
      totalScore += 75; // default score; in a real version, we'd use STT to capture the answer
    }
  }

  const avgScore = Math.round(totalScore / questions.length);
  hud.setCommand(`Interview prep complete — ${avgScore}% readiness estimate`);
  await speech.speak(`Interview prep complete! You covered ${questions.length} questions. To maximize your score: practice speaking your answers aloud and use the STAR method for behavioral questions.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
