const fs = require('fs');
const path = require('path');

exports.getStates = (req, res) => {
    try {
        const statesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/states.json'), 'utf8'));
        const states = Object.keys(statesData);
        res.status(200).json({
            success: true,
            data: states
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching states',
            error: error.message
        });
    }
};

exports.getCities = (req, res) => {
    try {
        const { state } = req.params;
        const statesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/states.json'), 'utf8'));

        if (!statesData[state]) {
            return res.status(404).json({
                success: false,
                message: 'State not found'
            });
        }

        res.status(200).json({
            success: true,
            data: statesData[state]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching cities',
            error: error.message
        });
    }
};
