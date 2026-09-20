#!/bin/bash
# Nakhl Restaurant — food image generation
cd /home/z/my-project
mkdir -p public/food
P="professional food photography, Persian restaurant dish, warm ambient lighting, rustic table setting, garnished beautifully, appetizing, high quality, detailed"

gen() {
  local file="$1"; local prompt="$2"
  if [ ! -s "public/food/$file.png" ]; then
    z-ai image -p "$prompt, $P" -o "public/food/$file.png" -s 1152x864 && echo "OK: $file" || echo "FAIL: $file"
  else
    echo "EXISTS: $file"
  fi
}

gen koobideh "two skewers of Persian koobideh kebab (ground lamb and beef) on saffron basmati rice with grilled tomato, sumac, fresh flatbread"
gen joojeh "Persian saffron chicken kebab joojeh kabab, golden marinated chicken skewers with charred tomato and lemon on rice"
gen barg "Persian beef barg kebab, tender filet mignon skewers with saffron, on basmati rice with butter"
gen shishlik "Persian shishlik lamb chops kebab with bones, grilled peppers and onions"
gen bakhtiari "Persian bakhtiari kebab combination of chicken and lamb pieces on skewers with rice"
gen chenjeh "Persian chenjeh kebab, cubed lamb meat skewers with spices"
gen ghormeh "Persian ghormeh sabzi stew with herbs, kidney beans and lamb in a rustic bowl with rice"
gen fesenjan "Persian fesenjan stew, rich walnut pomegranate chicken stew in traditional bowl"
gen zereshk "Persian zereshk polo ba morgh, saffron rice topped with barberries and pistachios with chicken"
gen baghali "Persian baghali polo, fava bean and dill rice with tender lamb shank"
gen kalame "traditional Kermani kalame bread with walnuts and Mazafati dates, regional Iranian pastry"
gen kashk "Persian kashk bademjan eggplant dip with mint oil, walnuts garnish in copper bowl"
gen shirazi "Persian shirazi salad, diced cucumber tomato onion salad in a glass bowl with abghooreh dressing"
gen sholezard "Persian sholezard saffron rice pudding garnished with cinnamon, pistachios and almonds"
gen bastani "traditional Persian saffron ice cream bastani Sonnati with pistachio flakes, rosewater, frozen"
gen doogh "Persian doogh yogurt drink in glass with dried mint garnish and ice cubes"
gen mojito "fresh mint mojito mocktail with lime slices and soda in tall glass"
gen gheyme "Persian gheymeh stew with split peas, potatoes and tomato in a bowl with rice"
gen bamieh "Persian okra stew khoresh bamieh with tomato sauce and lamb, rustic bowl"
gen lobia "Persian loobia polo green bean rice with ground meat and tomato"

# Hero images
if [ ! -s public/food/hero.png ]; then
  z-ai image -p "luxurious Persian restaurant interior with date palm trees motifs, warm golden and emerald green ambient light, traditional Iranian architecture arches, cozy elegant dining atmosphere, no people, cinematic" -o public/food/hero.png -s 1440x720 && echo "OK: hero"
fi
if [ ! -s public/food/nakhl-logo.png ]; then
  z-ai image -p "minimalist elegant logo of a stylized date palm tree inside a circular emblem, emerald green and gold colors, flat vector style, restaurant branding, clean white background" -o public/food/nakhl-logo.png -s 1024x1024 && echo "OK: logo"
fi
echo "ALL DONE"
