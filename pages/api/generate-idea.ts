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

1. Détecter les sujets puissants et récurrents qui se cachent dans ces titres.
2. Imaginer un seul nouveau titre pour une vidéo YouTube, en français, ultra pertinent pour un créateur ambitieux en francophonie.
3. Ne fais pas une simple traduction : réadapte le style, le vocabulaire et le ton pour que ça sonne 100% natif français.
4. Ton titre doit être court, percutant, et donner très envie de cliquer. Il peut être formulé comme :

   - une promesse chiffrée
   - une méthode découverte
   - une stratégie secrète
   - une étude de cas surprenante
   - une annonce choquante ou rare
   
Tu peux fusionner plusieurs idées ou les adapter, mais ne sors pas de la niche. Pas d'explication, juste le titre seul.

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
