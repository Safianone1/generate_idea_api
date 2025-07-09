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

1. Identifie un sujet puissant ou un pattern à fort potentiel dans ces titres US.
2. Garde le fond, mais réécris le titre en français, comme un YouTuber natif le ferait.
3. Ne fais surtout pas une simple traduction : adapte les mots, l’ordre, l’énergie.
4. Ton titre doit sonner comme une vraie vidéo française, naturelle.

Format attendu : un seul titre, court, sans guillemets, sans explication. Le ton doit être :
- personnel
- direct
- clair

Inspire-toi du style de ces adaptations réussies :
- “Cet agent IA envoie +2500 messages par jour à ma place”
- “J'ai lancé & vendu un produit en 8h (et j'ai tout documenté)”
- “Comment j'envoie +2500 dm/jour en autopilote (€€€)”
- “How I made $18,000 with 1 video” → “Ce hack YouTube m’a rapporté 18 000€ avec une seule vidéo”
- “I copied MrBeast’s strategy to go viral” → “J’ai copié une stratégie virale d’un géant US… voici le résultat”
- “3 YouTube Shorts that made $10,000+” → “Les 3 Shorts YouTube qui m’ont rapporté plus de 10 000€”

À chaque génération, tu choisis une seule idée forte parmi les titres ci-dessus de façon vraiment aléatoire dans la liste (ou une combinaison logique entre 2 max), ou tu en proposes une nouvelle fortement inspirée. 
Pas de résumé, pas de mélange de toutes les idées.  
Juste un seul titre YouTube puissant, bien formulé pour un public francophone.

Génère maintenant un nouveau titre adapté, aussi naturel et viral que ces exemples. Juste le titre.

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
