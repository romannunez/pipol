#!/bin/bash
echo "Packaging Pipol app for download..."

# Create a zip file of the app
cd pipol-app
zip -r ../pipol-app.zip . -x "node_modules/*" -x ".git/*"
cd ..

echo "App packaged successfully as pipol-app.zip"
echo ""
echo "To use the app on your iPhone:"
echo "1. Download pipol-app.zip"
echo "2. Extract the files on your computer"
echo "3. Open terminal/command prompt and navigate to the extracted folder"
echo "4. Run 'npm install'"
echo "5. Run 'npx expo start'"
echo "6. Scan the QR code with your iPhone camera or the Expo Go app"
echo ""
echo "Login credentials:"
echo "Email: test@example.com"
echo "Password: testpassword"