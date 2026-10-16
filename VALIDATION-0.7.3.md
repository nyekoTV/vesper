# Vesper 0.7.3

- Tests import GIF : restrictions URL et redirections, extraction des métadonnées, octets GIF intégrés, refus de formats incorrects et de flux supérieurs à 512 Ko.
- Tests API : authentification de l’import, refus d’origine étrangère et de destination locale. Régression messagerie, rôles, vocal et réactions.
- Tests réels : page GIPHY publique importée (189898 octets) ; GIF direct Tenor public importé (122984 octets).
- Limite : une page Tenor testée retourne un document HTML à la place du média ; une erreur propose l’import du fichier ou le lien direct.
- Vérification navigateur locale indisponible : l’onglet de test existant est bloqué par la politique du navigateur. Aucun contournement tenté. Contrôles de syntaxe et tests serveur utilisés.
