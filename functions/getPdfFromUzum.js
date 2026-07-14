const axios = require('axios');

exports.getPdfFromUzum = async (orderId) => {
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://api-seller.uzum.uz/api/seller-openapi/v1/fbs/order/${orderId}/labels/print?size=BIG`,
        headers: {
            'Authorization': '5ggP9G6N9pGiar00ZsnOQ/Iaw2eN8VbbI/MGTA9s8Wo=',
            'Cookie': '_yasc=eA5tZTtHiOVThlJt40iF4/avOYM6/jBuIgavFIg0V3+4u7zIGps4IAimeyycOg=='
        }
    };

    try {
        const response = await axios.request(config);
        return response.data;
    } catch (error) {
        console.error(`Error fetching PDF for order ID ${orderId}:`,
            error);
        throw error;
    }
}


// http://156.34.92.40:5000/merge-pdf POST
// http://156.34.92.40:5000/generate-qr-code POST

// https://api.buyo.uz/merge-pdf POST
// https://api.buyo.uz/generate-qr-code POST

// IP bo'yicha dostup