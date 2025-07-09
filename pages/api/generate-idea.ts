console.log("✅ API called");﻿
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("✅ API /generate-idea hit");
  
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-id");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const userId = req.headers["x-user-id"];
  if (typeof userId !== "string" || !userId || userId === "undefined") {
    return res.status(401).json({ error: "Utilisateur non authentifié." });
  }

  // 🔒 Vérification de la limite journalière
  const { count, error: countError } = await supabase
    .from("idea_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("timestamp", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());

  if (countError) {
    return res.status(500).json({ error: "Erreur lors de la vérification du quota." });
  }
  if ((count ?? 0) >= 20) {
    return res.status(429).json({ error: "Limite quotidienne atteinte (20 idées max / jour)." });
  }
    
  const { data: videos, error } = await supabase
    .from('ideo_feed')
    .select('title') // 🔁 Ne sélectionne que "title"
    .eq('user_id', userId)
    .limit(25); // ⛔️ Enlève l'ordre sur "views" pour éviter tout crash

  if (error || !videos || videos.length === 0) {
    return res.status(500).json({ error: "Impossible de récupérer les vidéos.", debug: { userId, videos, supabaseError: error } });
  }

  const formattedList = videos.map(v => `- ${v.title}`).join("\n");

  const prompt = (
    `
Tu es un expert en stratégie YouTube. Voici des titres de vidéos qui ont très bien marché récemment aux États-Unis dans des niches proches :

${formattedList}

Ta mission :

1. À chaque génération, tu dois créer un **seul** titre en français, court, puissant, qui adapte **une seule idée forte** parmi les titres ci-dessus. 
   Tu peux aussi générer une **nouvelle idée** qui s’inspire fortement d’une ou plusieurs de ces vidéos (concept dérivé, même pattern viral, etc.).

2. Ne fais **jamais** un résumé ou une synthèse de plusieurs titres à la fois. Tu dois te baser **sur une seule idée ou inspiration principale par génération**.

3. Tu ne dois **pas faire une traduction littérale**. Tu dois adapter les mots, le ton, l’ordre, l’énergie — comme un **YouTuber français natif**.

4. Ton titre doit sonner **ultra naturel**, presque parlé à l’oral, dans un style personnel, captivant, dopaminé. Il doit donner **très envie de cliquer**.

5. Le **storytelling implicite** est une des clés d’un bon titre viral. Chaque titre doit :
   - créer une **tension ou un mystère**
   - montrer un **avant/après** ou une **transformation**
   - faire comprendre qu’on va apprendre une méthode, un hack, ou voir une preuve concrète de résultats

6. Le style doit être :
   - **direct**, jamais trop marketing ou commercial
   - sans formule "tunnel de vente" (évite : "Découvrez", "Apprenez", "Le secret", etc.)
   - **personnel** ("je", "mon", "ma stratégie", etc.) ou **intriguant**
   - **clair et simple**, comme un message oral d’un YouTuber

7. Tu dois **éviter de générer plusieurs fois les mêmes idées**. Chaque titre généré doit s’inspirer d’un titre différent parmi la liste (ou au pire en combiner deux **logiquement compatibles**). Ton objectif est de **varier au maximum** les sources d’inspiration pour ne pas tourner autour des 3 mêmes idées à chaque génération.

8. Tu peux intégrer :
   - des chiffres (gains, temps, conversions) **crédibles** et à l’européenne (ex : 3 200€, pas $3,200)

Exemples de titres bien formulés à la française :

- “J'ai lancé & vendu un produit en 8h (et j'ai tout documenté)”
- “Comment j'envoie +2500 dm/jour en autopilote (€€€)”
- “Cet agent IA envoie +2500 messages par jour à ma place”
- “How I made $18,000 with 1 video” → “Ce hack YouTube m’a rapporté 18 000€ avec une seule vidéo”
- “I copied MrBeast’s strategy to go viral” → “J’ai copié une stratégie virale d’un géant US… voici le résultat”
- “3 YouTube Shorts that made $10,000+” → “Les 3 Shorts YouTube qui m’ont rapporté plus de 10 000€”
- “J’ai copié cette stratégie YouTube US… Résultat : 32 000€ en 12 jours”
- “Comment cette idée volée à un YouTuber américain m’a rapporté 18k€ en une semaine”
- “Je me suis inspiré de MrBeast… Voici ce qui s’est passé (résultat choc)”

Contraintes :

- Pas d’intro, pas d’explication, **juste le titre brut**
- Format : une **phrase unique**, pas de bullet points
- Pas de langage artificiel ou robotique (pas : “Ce système exact…” ou “voici l’outil IA le plus efficace…”)
- Ton = **ultra humain, crédible, oral, dopaminé**, francophone

Ton objectif :

Créer **un seul titre YouTube francophone** avec un **potentiel de viralité maximal**, basé sur un concept US qui a déjà prouvé sa viralité (proven concept). 

Ce titre doit donner envie de cliquer **immédiatement**.

Commence ta génération maintenant. Ne retourne qu’un seul titre par appel.

    `
  ).trim();

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "Tu es un expert YouTube très concis et percutant." },
        { role: "user", content: prompt },
      ],
      model: "gpt-4-turbo",
    });

    const idea = completion.choices[0].message.content;

    // ✅ Log de l'usage pour cette requête
    await supabase.from("idea_usage").insert({
      user_id: userId,
    });
    
    return res.status(200).json({ idea });
  } catch (err) {
    return res.status(500).json({ error: "Erreur lors de la génération." });
  }
}
