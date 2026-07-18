import Phaser from "phaser";
import { generateObjectTextures } from "@/lib/object-textures";

// 16 office tiles, each 32x32, laid out in a single row (512x32)
// Tile indices:
//  0: empty/transparent
//  1: floor (warm gray carpet)
//  2: wall (darker with top border)
//  3: desk (brown)
//  4: chair (blue, smaller)
//  5: computer screen (dark with green dot)
//  6: plant (green circle on brown pot)
//  7: door (lighter gap in wall)
//  8: meeting table (large, dark brown)
//  9: coffee area (brown with cup)
// 10: water cooler (light blue)
// 11: bookshelf (brown with colored lines)
// 12: carpet (darker floor for meeting room)
// 13: whiteboard (white rect on wall)
// 14: reception desk (curved, lighter brown)
// 15: cubicle wall (thin gray partition)

const TILE = 32;

function drawTile(g: Phaser.GameObjects.Graphics, index: number): void {
  const x = index * TILE;

  switch (index) {
    case 0: // empty — just leave transparent (fill with alpha 0)
      break;

    case 1: // floor — warm gray carpet
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      g.lineStyle(1, 0x7a7368, 0.3);
      g.strokeRect(x, 0, TILE, TILE);
      // Subtle carpet texture dots
      g.fillStyle(0x7f7a6e, 0.3);
      g.fillRect(x + 6, 6, 2, 2);
      g.fillRect(x + 18, 14, 2, 2);
      g.fillRect(x + 10, 24, 2, 2);
      g.fillRect(x + 26, 8, 2, 2);
      break;

    case 2: // wall — darker with top highlight
      g.fillStyle(0x4a4a5e);
      g.fillRect(x, 0, TILE, TILE);
      // Top edge highlight
      g.fillStyle(0x6a6a7e);
      g.fillRect(x, 0, TILE, 4);
      // Brick-like lines
      g.lineStyle(1, 0x3a3a4e, 0.4);
      g.lineBetween(x, 16, x + TILE, 16);
      g.lineBetween(x + 16, 4, x + 16, 16);
      g.lineBetween(x + 8, 16, x + 8, TILE);
      g.lineBetween(x + 24, 16, x + 24, TILE);
      g.lineStyle(1, 0x5a5a6e, 0.5);
      g.strokeRect(x, 0, TILE, TILE);
      break;

    case 3: // desk — brown wooden
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Desk top
      g.fillStyle(0x6b4226);
      g.fillRect(x + 2, 4, 28, 20);
      // Desk edge (darker)
      g.fillStyle(0x523218);
      g.fillRect(x + 2, 22, 28, 4);
      // Wood grain
      g.lineStyle(1, 0x7a5236, 0.4);
      g.lineBetween(x + 4, 8, x + 28, 8);
      g.lineBetween(x + 6, 14, x + 26, 14);
      break;

    case 4: // chair — blue, smaller
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Chair seat
      g.fillStyle(0x4060b0);
      g.fillRect(x + 8, 10, 16, 14);
      // Chair back
      g.fillStyle(0x3050a0);
      g.fillRect(x + 8, 6, 16, 6);
      // Chair legs
      g.fillStyle(0x333333);
      g.fillRect(x + 10, 24, 3, 4);
      g.fillRect(x + 19, 24, 3, 4);
      break;

    case 5: // computer screen
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Monitor
      g.fillStyle(0x222233);
      g.fillRect(x + 6, 4, 20, 16);
      // Screen
      g.fillStyle(0x1a3a2a);
      g.fillRect(x + 8, 6, 16, 12);
      // Green indicator
      g.fillStyle(0x44ff44);
      g.fillCircle(x + 16, 12, 2);
      // Stand
      g.fillStyle(0x444444);
      g.fillRect(x + 13, 20, 6, 4);
      g.fillRect(x + 10, 24, 12, 2);
      break;

    case 6: // plant
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Pot
      g.fillStyle(0x8b4513);
      g.fillRect(x + 10, 20, 12, 10);
      g.fillStyle(0x6b3210);
      g.fillRect(x + 8, 18, 16, 4);
      // Leaves
      g.fillStyle(0x2d8b2d);
      g.fillCircle(x + 16, 12, 8);
      g.fillStyle(0x3aa53a);
      g.fillCircle(x + 13, 10, 5);
      g.fillCircle(x + 19, 10, 5);
      g.fillCircle(x + 16, 7, 4);
      break;

    case 7: // door — lighter gap in wall
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Door frame
      g.fillStyle(0x6b5a3a);
      g.fillRect(x + 2, 0, 28, TILE);
      // Door panel
      g.fillStyle(0x8b7a5a);
      g.fillRect(x + 4, 2, 24, 28);
      // Door handle
      g.fillStyle(0xd4af37);
      g.fillCircle(x + 23, 18, 2);
      // Door panels detail
      g.lineStyle(1, 0x7a6a4a, 0.5);
      g.strokeRect(x + 6, 4, 9, 12);
      g.strokeRect(x + 17, 4, 9, 12);
      break;

    case 8: // meeting table — large, dark brown
      // Floor underneath (meeting carpet)
      g.fillStyle(0x6b6560);
      g.fillRect(x, 0, TILE, TILE);
      // Table
      g.fillStyle(0x4a3020);
      g.fillRect(x + 2, 2, 28, 28);
      // Table surface highlight
      g.fillStyle(0x5a4030);
      g.fillRect(x + 4, 4, 24, 24);
      // Reflection
      g.fillStyle(0x6a5040, 0.4);
      g.fillRect(x + 6, 6, 10, 6);
      break;

    case 9: // coffee area
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Counter
      g.fillStyle(0x5a4a3a);
      g.fillRect(x + 2, 4, 28, 24);
      // Coffee machine
      g.fillStyle(0x333333);
      g.fillRect(x + 6, 6, 12, 16);
      // Red light
      g.fillStyle(0xff3333);
      g.fillCircle(x + 12, 10, 2);
      // Cup
      g.fillStyle(0xffffff);
      g.fillRect(x + 20, 14, 6, 8);
      g.fillStyle(0x8b6914);
      g.fillRect(x + 21, 15, 4, 6);
      break;

    case 10: // water cooler
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Base
      g.fillStyle(0xcccccc);
      g.fillRect(x + 8, 16, 16, 14);
      // Water bottle
      g.fillStyle(0x88bbff);
      g.fillRect(x + 10, 2, 12, 16);
      // Water level
      g.fillStyle(0x6699dd);
      g.fillRect(x + 10, 6, 12, 12);
      // Cap
      g.fillStyle(0x4477bb);
      g.fillRect(x + 12, 0, 8, 4);
      // Tap
      g.fillStyle(0x888888);
      g.fillRect(x + 22, 18, 4, 3);
      break;

    case 11: // bookshelf
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Shelf frame
      g.fillStyle(0x5a3a1a);
      g.fillRect(x + 2, 2, 28, 28);
      // Shelves
      g.fillStyle(0x6b4a2a);
      g.fillRect(x + 2, 10, 28, 2);
      g.fillRect(x + 2, 20, 28, 2);
      // Books (colored spines)
      const bookColors = [0xcc3333, 0x3366cc, 0x33aa33, 0xccaa33, 0x9933cc, 0xcc6633];
      for (let i = 0; i < 6; i++) {
        g.fillStyle(bookColors[i]);
        g.fillRect(x + 4 + i * 4, 3, 3, 7);
        g.fillRect(x + 4 + i * 4, 13, 3, 7);
        g.fillRect(x + 4 + i * 4, 23, 3, 5);
      }
      break;

    case 12: // darker carpet for meeting room
      g.fillStyle(0x6b6560);
      g.fillRect(x, 0, TILE, TILE);
      g.lineStyle(1, 0x5e5a55, 0.3);
      g.strokeRect(x, 0, TILE, TILE);
      // Carpet pattern
      g.fillStyle(0x625e58, 0.3);
      g.fillRect(x + 4, 4, 3, 3);
      g.fillRect(x + 20, 12, 3, 3);
      g.fillRect(x + 12, 22, 3, 3);
      break;

    case 13: // whiteboard
      // Wall behind
      g.fillStyle(0x4a4a5e);
      g.fillRect(x, 0, TILE, TILE);
      // Board frame
      g.fillStyle(0xcccccc);
      g.fillRect(x + 3, 4, 26, 20);
      // Board surface
      g.fillStyle(0xf0f0f0);
      g.fillRect(x + 5, 6, 22, 16);
      // Some "writing"
      g.lineStyle(1, 0x3366cc, 0.5);
      g.lineBetween(x + 8, 10, x + 22, 10);
      g.lineBetween(x + 8, 14, x + 20, 14);
      g.lineBetween(x + 8, 18, x + 18, 18);
      // Marker tray
      g.fillStyle(0xaaaaaa);
      g.fillRect(x + 6, 24, 20, 3);
      break;

    case 14: // reception desk
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Desk body (lighter brown, curved feel)
      g.fillStyle(0x8b6b3a);
      g.fillRect(x + 2, 6, 28, 20);
      // Counter top
      g.fillStyle(0x9b7b4a);
      g.fillRect(x + 2, 4, 28, 6);
      // Front panel detail
      g.fillStyle(0x7b5b2a);
      g.fillRect(x + 4, 14, 24, 10);
      // Sign/logo area
      g.fillStyle(0xd4af37);
      g.fillRect(x + 12, 16, 8, 4);
      break;

    case 15: // cubicle wall — thin gray partition
      // Floor underneath
      g.fillStyle(0x8b8378);
      g.fillRect(x, 0, TILE, TILE);
      // Partition
      g.fillStyle(0x888899);
      g.fillRect(x + 12, 0, 8, TILE);
      // Partition frame
      g.fillStyle(0x777788);
      g.fillRect(x + 12, 0, 2, TILE);
      g.fillRect(x + 18, 0, 2, TILE);
      // Fabric texture
      g.fillStyle(0x9999aa, 0.3);
      g.fillRect(x + 14, 4, 4, 4);
      g.fillRect(x + 14, 12, 4, 4);
      g.fillRect(x + 14, 20, 4, 4);
      break;
  }
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  create(): void {
    const graphics = this.add.graphics();

    // Draw all 16 tiles
    for (let i = 0; i < 16; i++) {
      drawTile(graphics, i);
    }

    graphics.generateTexture("office-tiles", 16 * TILE, TILE);
    graphics.destroy();

    // Create a fallback placeholder sprite (colored square) for missing textures
    const fallback = this.add.graphics();
    fallback.fillStyle(0x6060a0);
    fallback.fillRect(0, 0, 64, 64);
    fallback.fillStyle(0x8080c0);
    fallback.fillRect(8, 8, 48, 48);
    fallback.generateTexture("fallback-char", 64, 64);
    fallback.destroy();

    generateObjectTextures(this);

    this.scene.start("GameScene");
  }
}
