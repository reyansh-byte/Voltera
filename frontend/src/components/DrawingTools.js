import React from 'react';

const DrawingTools = ({ onDraw, onClear }) => {
    return (
        <div className="drawing-tools">
            <button onClick={onDraw}>Draw Polygon</button>
            <button onClick={onClear}>Clear Drawing</button>
        </div>
    );
};

export default DrawingTools;