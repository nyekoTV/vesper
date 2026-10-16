# Vérification Vesper 0.7

54 tests réussis. Tests API de permissions des salons privés, indicateur SSE éphémère, réactions signées et chiffrées, rejet des auteurs usurpés, persistance et suppression en cascade. Tests purs de l’expiration et des limites de mots des mentions.

Deux comptes fictifs dans le navigateur sur base distincte : « Alice écrit… » reçu, suggestion @qa_bob insérée puis message envoyé, mise en évidence pour le destinataire, réaction 💜 visible sur les deux comptes avec état personnel sélectionné. Les octets de brouillon ne sont jamais envoyés. Capture outputs/vesper-messages-v07.jpg.

Les pièces jointes conservent leur limite. Pas de notification push externe ni de mention @everyone.
