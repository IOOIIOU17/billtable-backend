const axios = require("axios");
const FormData = require("form-data");

const uploadToCloudinary = async (buffer) => {
  const formData = new FormData();
  formData.append("file", buffer, { filename: "upload.jpg", contentType: "image/jpeg" });
  formData.append("upload_preset", "billtable_menu");

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const response = await axios.post(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    formData,
    { headers: formData.getHeaders() }
  );

  return response.data.secure_url;
};

module.exports = uploadToCloudinary;
