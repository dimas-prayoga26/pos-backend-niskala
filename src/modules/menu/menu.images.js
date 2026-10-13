const fs = require("fs/promises");
const path = require("path");
const { MENU_UPLOAD_DIR } = require("../../config/paths");
const MenuItem = require("./menu.repository");

const LOCAL_MENU_IMAGE_PREFIX = "/uploads/menu/";

// Only deletes files inside uploads/menu that were referenced as /uploads/menu/<file>.
const removeLocalMenuImage = async (imagePath) => {
  if (
    typeof imagePath !== "string" ||
    !imagePath.startsWith(LOCAL_MENU_IMAGE_PREFIX)
  ) {
    return;
  }

  const fileName = path.posix.basename(imagePath);
  const filePath = path.resolve(MENU_UPLOAD_DIR, fileName);

  if (path.dirname(filePath) !== MENU_UPLOAD_DIR) return;

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

// Deletes the previous image once no menu item references it any more.
const removeImageIfUnused = async (oldImagePath, nextImagePath = null) => {
  if (!oldImagePath || oldImagePath === nextImagePath) return;

  const referenceCount = await MenuItem.countImagePathReferences(oldImagePath);
  if (referenceCount === 0) {
    await removeLocalMenuImage(oldImagePath);
  }
};

module.exports = { removeImageIfUnused };
