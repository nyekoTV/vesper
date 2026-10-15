@echo off
cd /d "%~dp0"
echo Vesper - ouvrez http://localhost:4180 dans votre navigateur.
echo Laissez cette fenetre ouverte. Ctrl+C pour arreter le serveur.
node --env-file-if-exists=.env server.mjs
pause
