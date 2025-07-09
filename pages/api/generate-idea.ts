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
Tu es un expert en stratégie YouTube. Voici des titres de vidéos qui ont bien fonctionné récemment :

${formattedList}

Ta mission est de proposer UN SEUL sujet de vidéo, en français, ultra pertinent pour un YouTuber français. Ce sujet peut être :

- Une reprise intelligente d’un de ces titres
- Une fusion de plusieurs
- Une adaptation au marché français
- Ou une petite variation qui a de grandes chances de percer

Ta réponse doit être courte : uniquement le titre proposé, sans explication.
    `
  ).trim();

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "Tu es un expert YouTube très concis et percutant." },
        { role: "user", content: prompt },
      ],
      model: "gpt-4o",
    });

    const idea = completion.choices[0].message.content;
    return res.status(200).json({ idea });
  } catch (err) {
    return res.status(500).json({ error: "Erreur lors de la génération." });
  }
}
