#!/bin/bash
set -e

echo "🚀 FacetPro Deployment"
echo "====================="
echo ""

if [ ! -d .git ]; then
    echo "Initializing git..."
    git init
    git add .
    git commit -m "Initial commit: FacetPro"
    echo "✓ Git initialized"
else
    echo "✓ Git already initialized"
fi

echo ""
echo "Next steps:"
echo "1. Go to: https://github.com/new"
echo "2. Create repo named: facetpro"
echo "3. Copy the 3 git commands GitHub shows"
echo "4. Paste them here and press Enter"
echo ""
echo "Once pushed to GitHub, go to:"
echo "5. https://vercel.com → New Project → Select facetpro"
echo "6. Click Deploy (takes 1-2 minutes)"
echo ""
echo "Then connect domain in Vercel → Settings → Domains"
echo ""
echo "Done! Your site will be live at: https://facetpro.co.uk"
