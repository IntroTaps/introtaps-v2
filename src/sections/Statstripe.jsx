
import { useEffect, useState, useRef } from 'react';
import Bif from '../functions/IconFlled';
import { useInView } from 'react-intersection-observer';

function Statstripe() {
    const [count1, setCount1] = useState(0);
    const [count2, setCount2] = useState(0);
    const [count3, setCount3] = useState(0);
    const { ref, inView } = useInView({
        triggerOnce: true,
        threshold: 0.1,
    });

    useEffect(() => {
        if (inView) {
            const interval1 = setInterval(() => {
                setCount1(prevCount => (prevCount < 10 ? prevCount + 1 : 10));
            }, 100);

            const interval2 = setInterval(() => {
                setCount2(prevCount => (prevCount < 11 ? prevCount + 1 : 11));
            }, 100);

            const interval3 = setInterval(() => {
                setCount3(prevCount => (prevCount < 88 ? prevCount + 1 : 88));
            }, 10);

            return () => {
                clearInterval(interval1);
                clearInterval(interval2);
                clearInterval(interval3);
            };
        }
    }, [inView]);

    return (
        <div ref={ref} className="row m-auto justify-content-center ">
            <div className="col-lg-4 left text-center statblock align-items-center justify-content-center">
                <div className="stat ">
                    <h4 className=''><b>ALMOST</b></h4>
                    <h3 className="heading-bold-1">{count1}M <Bif i="tree"/></h3>
                    <p className="text-white-50">Trees are cut down every year to make paper business cards
                    </p>
                </div>
            </div>
            <div className="col-lg-4 text-center statblock dark align-items-center justify-content-center">
                <div className="stat">
                    <h4 className=''><b>AND</b></h4>
                    <h3 className="heading-bold-1">{count2}B+ <Bif i="person-vcard"/></h3>
                    <p className="text-muted">Paper Visiting Cards are printed, every week
                    </p>
                </div>
            </div>
            <div className="col-lg-4 right text-center statblock align-items-center justify-content-center">
                <div className="stat">
                    <h4 className=''><b>BUT</b></h4>
                    <h3 className="heading-bold-1"><Bif i="trash"/> {count3}% </h3>
                    <p className="text-white-50">End up being thrown away in a dustbin, within a week
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Statstripe;